# Streamer for bench/embedCorpus.ts: reads one Common Pile dataset over HTTP, file by file, and prints one
# JSON document per line on stdout: {source, id, license, title, url?, text}. It stops when its stdout
# closes (the TS side kills it once it has enough), so nothing is downloaded whole. The license string goes
# out raw: bench/embedCorpus.ts owns which licenses pass. Shards are read interleaved, in a seeded random
# order, keeping a seeded fraction of each shard's rows, so a sample draws from the head of every shard rather
# than only the first.
import argparse
import gzip
import json
import random
import sys

import requests
from huggingface_hub import list_repo_files

ap = argparse.ArgumentParser()
ap.add_argument('--source', required=True, help='short name written into each row, e.g. libretexts')
ap.add_argument('--dataset', required=True, help='Hugging Face dataset id, e.g. common-pile/libretexts')
ap.add_argument('--max-docs', type=int, default=0, help='stop after this many rows (0 = no limit)')
ap.add_argument('--seed', type=int, default=7, help='seeds the shard order and the row sampling')
ap.add_argument('--fraction', type=float, default=1.0, help='keep this seeded fraction of each shard rows (1 = every row)')
args = ap.parse_args()

files = sorted(f for f in list_repo_files(args.dataset, repo_type='dataset') if f.endswith('.gz'))
rng = random.Random(args.seed)
rng.shuffle(files)


def shard_lines(name):
    """Every line of one shard, streamed; the connection closes once the caller stops asking."""
    url = f'https://huggingface.co/datasets/{args.dataset}/resolve/main/{name}'
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with gzip.GzipFile(fileobj=r.raw) as gz:
            for line in gz:
                if args.fraction >= 1 or rng.random() < args.fraction:
                    yield line


streams = [shard_lines(f) for f in files]
n = 0
while streams:
    for stream in list(streams):
        line = next(stream, None)
        if line is None:
            streams.remove(stream)
            continue
        line = line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except ValueError:
            continue
        meta = row.get('metadata') or {}
        text = row.get('text')
        if not isinstance(text, str) or not text.strip():
            continue
        out = {
            'source': args.source,
            'id': str(row.get('id', n)),
            'license': str(meta.get('license') or ''),
            'title': str(meta.get('title') or ''),
            'text': text,
        }
        if meta.get('url'):
            out['url'] = str(meta['url'])
        try:
            sys.stdout.write(json.dumps(out, ensure_ascii=False) + '\n')
            sys.stdout.flush()
        except BrokenPipeError:
            sys.exit(0)
        n += 1
        if args.max_docs and n >= args.max_docs:
            sys.exit(0)
