# Trainer for bench/finetuneEmbed.ts: fine-tunes the default embedder (bge-small-en-v1.5) on
# (query, passage) pairs with in-batch negatives, never two pairs of one passage in a batch, then exports
# it the way transformers.js loads it: config + tokenizer + onnx/model_quantized.onnx (dynamic int8).
# With no pairs it exports the model untouched, which is the base a variant is compared against.
# `--general` (public text): hard negatives mined with the base model, MNRL at --scale, then weight-averaged
# exports (LM-Cocktail) and an eval.json scored on the exported int8 ONNX (held-out MRR@10 + BEIR nDCG@10).
# Prints the held-out MRR@10 of the queries of chunks it never trained on, before and after.
import argparse
import json
import os
import shutil
import tempfile
import time

BASE = 'BAAI/bge-small-en-v1.5'

ap = argparse.ArgumentParser()
ap.add_argument('--pairs', required=True)
ap.add_argument('--heldout', required=True)
ap.add_argument('--work', required=True)
ap.add_argument('--export', required=True)
ap.add_argument('--epochs', type=float, default=1)
ap.add_argument('--lr', type=float, default=2e-5)
ap.add_argument('--batch', type=int, default=32)
ap.add_argument('--device', default='cpu')
ap.add_argument('--threads', type=int, default=4)
ap.add_argument('--fp32', action='store_true', help='export unquantized, under the int8 file name transformers.js loads for q8')
ap.add_argument('--general', action='store_true')
ap.add_argument('--name', default='')
ap.add_argument('--export-root', default='')
ap.add_argument('--eval-out', default='')
ap.add_argument('--beir-cache', default='')
ap.add_argument('--scale', type=float, default=50)
ap.add_argument('--negatives', type=int, default=1)
ap.add_argument('--merge', default='0.3,0.5,0.7')
ap.add_argument('--beir', default='scifact,nfcorpus,fiqa,arguana')
ap.add_argument('--beir-limit', type=int, default=0)
args = ap.parse_args()

import torch  # noqa: E402
from sentence_transformers import SentenceTransformer, SentenceTransformerTrainer, SentenceTransformerTrainingArguments  # noqa: E402
from sentence_transformers.losses import MultipleNegativesRankingLoss  # noqa: E402
from sentence_transformers.training_args import BatchSamplers  # noqa: E402


def read(path):
    with open(path) as f:
        return [json.loads(l) for l in f if l.strip()]


def mrr10(model, held):
    if not held:
        return None
    passages = sorted({h['passage'] for h in held})
    index = {p: i for i, p in enumerate(passages)}
    pe = model.encode(passages, batch_size=64, normalize_embeddings=True, convert_to_tensor=True)
    qe = model.encode([h['query'] for h in held], batch_size=64, normalize_embeddings=True, convert_to_tensor=True)
    top = torch.topk(qe @ pe.T, k=min(10, len(passages)), dim=1).indices.tolist()
    total = 0.0
    for h, row in zip(held, top):
        want = index[h['passage']]
        if want in row:
            total += 1 / (row.index(want) + 1)
    return total / len(held)


pairs = read(args.pairs)
held = read(args.heldout)
# CPU by default: a shared laptop under memory pressure thrashes the GPU at this batch size
torch.set_num_threads(args.threads)
model = SentenceTransformer(BASE, device=args.device)
# vault chunks run about 150 tokens, so training truncates at 256; the export goes back to 512, the
# length the shipped tokenizer truncates at
model.max_seq_length = 256
before = mrr10(model, held)

BGE_QUERY = 'Represent this sentence for searching relevant passages: '
CE = 'cross-encoder/ms-marco-MiniLM-L-6-v2'


def mine_negatives(model, pairs):
    """One hard negative per pair: base-model rank 10-50 among the training passages, never from the
    positive's own file, dropped when the cross-encoder scores it at or above the positive. Pairs with no
    such passage are dropped."""
    import random

    from sentence_transformers import CrossEncoder

    passages = sorted({p['passage'] for p in pairs})
    pidx = {t: i for i, t in enumerate(passages)}
    files = {}
    for p in pairs:
        files.setdefault(p['passage'], p.get('file'))
    pfile = [files[t] for t in passages]
    pe = model.encode(passages, batch_size=64, normalize_embeddings=True, convert_to_tensor=True)
    queries = sorted({p['query'] for p in pairs})
    qe = model.encode(queries, batch_size=64, normalize_embeddings=True, convert_to_tensor=True)
    top = torch.topk(qe @ pe.T, k=min(50, len(passages)), dim=1).indices.tolist()
    cands = {q: row[10:50] for q, row in zip(queries, top)}
    ce = CrossEncoder(CE, device='cpu', max_length=256)
    rng = random.Random(7)
    out, dropped = [], 0
    for p in pairs:
        own = pfile[pidx[p['passage']]]
        pool = [c for c in cands[p['query']] if c != pidx[p['passage']] and not (own and pfile[c] == own)]
        rng.shuffle(pool)
        pool = pool[:6]
        if not pool:
            dropped += 1
            continue
        raw = p['query'][len(BGE_QUERY):] if p['query'].startswith(BGE_QUERY) else p['query']
        scores = ce.predict([(raw, p['passage'])] + [(raw, passages[c]) for c in pool], batch_size=32, show_progress_bar=False)
        ok = [c for c, sc in zip(pool, scores[1:]) if sc < scores[0]]
        if not ok:
            dropped += 1
            continue
        out.append({**p, 'negative': passages[ok[0]]})
    print(json.dumps({'negatives': {'mined': len(out), 'dropped': dropped}}), flush=True)
    return out


if args.general:
    base_state = {k: v.detach().clone() for k, v in model[0].auto_model.state_dict().items()}
steps_per_sec = None
if pairs:
    from datasets import Dataset

    if args.general and args.negatives:
        pairs = mine_negatives(model, pairs)
    cols = [{'anchor': p['query'], 'positive': p['passage'], **({'negative': p['negative']} if 'negative' in p else {})} for p in pairs]
    ds = Dataset.from_list(cols).shuffle(seed=7)
    targs = SentenceTransformerTrainingArguments(
        output_dir=os.path.join(args.work, 'checkpoints'),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        learning_rate=args.lr,
        warmup_ratio=0.1,
        batch_sampler=BatchSamplers.NO_DUPLICATES,
        save_strategy='no',
        logging_steps=50,
        report_to=[],
        seed=7,
        use_cpu=args.device == 'cpu',
        dataloader_pin_memory=False,
    )
    loss = MultipleNegativesRankingLoss(model, scale=args.scale) if args.general else MultipleNegativesRankingLoss(model)
    trainer = SentenceTransformerTrainer(model=model, args=targs, train_dataset=ds, loss=loss)
    t0 = time.time()
    trainer.train()
    steps_per_sec = trainer.state.global_step / max(1e-9, time.time() - t0)
    print(json.dumps({'steps': trainer.state.global_step, 'stepsPerSec': steps_per_sec}), flush=True)

after = mrr10(model, held)
print(json.dumps({'pairs': len(pairs), 'heldout': len(held), 'heldoutMrr10': {'before': before, 'after': after}}))

# export: the HF transformer as ONNX (last_hidden_state; transformers.js pools CLS itself), then int8
from optimum.onnxruntime import ORTModelForFeatureExtraction  # noqa: E402
from onnxruntime.quantization import QuantType, quantize_dynamic  # noqa: E402


def export(model, export_dir):
    with tempfile.TemporaryDirectory() as tmp:
        hf = os.path.join(args.work, 'model')
        model.to('cpu')
        model.max_seq_length = 512
        model.save(hf)
        onnx_dir = os.path.join(tmp, 'onnx')
        ORTModelForFeatureExtraction.from_pretrained(hf, export=True).save_pretrained(onnx_dir)
        shutil.rmtree(export_dir, ignore_errors=True)
        os.makedirs(os.path.join(export_dir, 'onnx'))
        # per-channel, reduced-range int8: the settings whose vectors match the shipped Xenova export
        # (cosine 0.998 on vault chunks); per-tensor int8 drifted to 0.95 and cost recall on its own
        out_onnx = os.path.join(export_dir, 'onnx', 'model_quantized.onnx')
        if args.fp32:
            shutil.copy(os.path.join(onnx_dir, 'model.onnx'), out_onnx)
        else:
            quantize_dynamic(os.path.join(onnx_dir, 'model.onnx'), out_onnx, per_channel=True, reduce_range=True, weight_type=QuantType.QInt8)
        for name in ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.txt']:
            for d in (onnx_dir, hf):
                src = os.path.join(d, name)
                if os.path.exists(src):
                    shutil.copy(src, os.path.join(export_dir, name))
                    break
        missing = [n for n in ('config.json', 'tokenizer.json', 'tokenizer_config.json') if not os.path.exists(os.path.join(export_dir, n))]
        if missing:
            raise SystemExit(f'export is missing {missing}')
    print(json.dumps({'exported': export_dir}), flush=True)


# ---- general mode: merged exports, then the eval on what ships ----------------------------------------


class Onnx:
    """The exported int8 model run in onnxruntime: CLS pooling, normalized, 512 tokens."""

    def __init__(self, export_dir):
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self.np = np
        so = ort.SessionOptions()
        so.intra_op_num_threads = args.threads
        self.sess = ort.InferenceSession(os.path.join(export_dir, 'onnx', 'model_quantized.onnx'), so, providers=['CPUExecutionProvider'])
        self.names = {i.name for i in self.sess.get_inputs()}
        self.tok = AutoTokenizer.from_pretrained(export_dir)

    def encode(self, texts, batch=32):
        np = self.np
        order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
        out = np.zeros((len(texts), 384), dtype='float32')
        for s in range(0, len(order), batch):
            idx = order[s : s + batch]
            enc = self.tok([texts[i] for i in idx], padding=True, truncation=True, max_length=512, return_tensors='np')
            feed = {k: v.astype('int64') for k, v in enc.items() if k in self.names}
            if 'token_type_ids' in self.names and 'token_type_ids' not in feed:
                feed['token_type_ids'] = np.zeros_like(feed['input_ids'])
            cls = self.sess.run(None, feed)[0][:, 0]
            out[idx] = cls / np.linalg.norm(cls, axis=1, keepdims=True)
        return out


def onnx_mrr10(m, held):
    if not held:
        return None
    np = m.np
    passages = sorted({h['passage'] for h in held})
    index = {p: i for i, p in enumerate(passages)}
    sims = m.encode([h['query'] for h in held]) @ m.encode(passages).T
    total = 0.0
    for h, row in zip(held, sims):
        top = np.argsort(-row)[:10].tolist()
        want = index[h['passage']]
        if want in top:
            total += 1 / (top.index(want) + 1)
    return total / len(held)


def beir_set(name):
    import urllib.request
    import zipfile

    root = os.path.join(args.beir_cache, name)
    if not os.path.exists(os.path.join(root, name, 'qrels', 'test.tsv')):
        os.makedirs(root, exist_ok=True)
        z = os.path.join(args.beir_cache, f'{name}.zip')
        if not os.path.exists(z):
            urllib.request.urlretrieve(f'https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/{name}.zip', z)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(root)
    d = os.path.join(root, name)
    corpus = {}
    with open(os.path.join(d, 'corpus.jsonl')) as f:
        for l in f:
            r = json.loads(l)
            corpus[r['_id']] = ((r.get('title') or '') + ' ' + (r.get('text') or '')).strip()
    queries = {}
    with open(os.path.join(d, 'queries.jsonl')) as f:
        for l in f:
            r = json.loads(l)
            queries[r['_id']] = r['text']
    qrels = {}
    with open(os.path.join(d, 'qrels', 'test.tsv')) as f:
        next(f)
        for l in f:
            q, c, sc = l.rstrip('\n').split('\t')[:3]
            if int(sc) > 0:
                qrels.setdefault(q, {})[c] = int(sc)
    return corpus, queries, qrels


def ndcg10(m, corpus, queries, qrels):
    import math

    np = m.np
    ids = list(corpus)
    qids = [q for q in qrels if q in queries]
    de = m.encode([corpus[i] for i in ids])
    qe = m.encode([BGE_QUERY + queries[q] for q in qids])
    sims = qe @ de.T
    total = 0.0
    for q, row in zip(qids, sims):
        # BEIR ignores a document identical to the query (ArguAna)
        top = [ids[j] for j in np.argsort(-row)[:11] if ids[j] != q][:10]
        rel = qrels[q]
        dcg = sum(rel.get(c, 0) / math.log2(r + 2) for r, c in enumerate(top))
        ideal = sum(g / math.log2(r + 2) for r, g in enumerate(sorted(rel.values(), reverse=True)[:10]))
        total += dcg / ideal if ideal else 0.0
    return total / len(qids)


def limited(corpus, queries, qrels, limit):
    """--beir-limit: the first `limit` queries, their relevant documents and up to 1000 others (smoke runs)."""
    import random

    qk = [q for q in qrels if q in queries][:limit]
    keep = {c for q in qk for c in qrels[q]}
    rest = [c for c in corpus if c not in keep]
    random.Random(7).shuffle(rest)
    keep |= set(rest[:1000])
    return {c: corpus[c] for c in corpus if c in keep}, queries, {q: qrels[q] for q in qk}


def evaluate(models):
    held_rows = held
    sets = [b for b in args.beir.split(',') if b]
    loaded = {}
    report = {'heldoutMrr10': {}, 'beir': {}}
    for key, export_dir in models.items():
        m = Onnx(export_dir)
        report['heldoutMrr10'][key] = onnx_mrr10(m, held_rows)
        report['beir'][key] = {}
        for b in sets:
            if b not in loaded:
                loaded[b] = beir_set(b)
                if args.beir_limit:
                    loaded[b] = limited(*loaded[b], args.beir_limit)
            report['beir'][key][b] = ndcg10(m, *loaded[b])
        print(json.dumps({'eval': key, 'heldoutMrr10': report['heldoutMrr10'][key], 'beir': report['beir'][key]}), flush=True)
    return report


if args.general:
    root = args.export_root
    tuned_state = {k: v.detach().clone() for k, v in model[0].auto_model.state_dict().items()}
    exports = {}

    def blend(alpha):
        # LM-Cocktail: element-wise alpha * tuned + (1 - alpha) * base, for float parameters
        merged = {k: (alpha * tuned_state[k] + (1 - alpha) * base_state[k]) if tuned_state[k].is_floating_point() else tuned_state[k] for k in tuned_state}
        model[0].auto_model.load_state_dict(merged)

    base_dir = os.path.join(root, f'{args.name}-base')
    blend(0.0)
    export(model, base_dir)
    models = {'base': base_dir}
    for a in [float(x) for x in args.merge.split(',') if x]:
        blend(a)
        n = f'{args.name}-m{round(a * 100)}'
        export(model, os.path.join(root, n))
        models[n] = os.path.join(root, n)
    blend(1.0)
    export(model, os.path.join(root, args.name))
    models[args.name] = os.path.join(root, args.name)
    report = evaluate(models)
    with open(args.eval_out, 'w') as f:
        json.dump(report, f, indent=1)
    print(json.dumps({'evalWritten': args.eval_out}))
else:
    export(model, args.export)
