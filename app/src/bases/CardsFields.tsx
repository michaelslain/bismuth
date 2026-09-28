import { Show, type Component } from 'solid-js'
import Select, { type SelectOption } from '../ui/Select'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'

export type CardsLook = {
    /** '' = default (properties). */
    cardContent: string
    /** '' = default (cover). */
    imageFit: string
    /** Aspect ratio as text; '' = default (0.667, a 2:3 portrait cover). */
    aspect: string
}

export type CardsFieldsProps = {
    value: CardsLook
    onChange: (value: CardsLook) => void
    /** Whether an image column is bound (fit + ratio only matter then). */
    hasImage: boolean
    class?: string
}

const CONTENT_OPTS: SelectOption[] = [
    { value: '', label: 'properties (cover + fields)' },
    { value: 'body', label: 'note body (editable)' },
    { value: 'tasks', label: 'checklist only' },
]
const FIT_OPTS: SelectOption[] = [
    { value: '', label: 'cover (crop to fill)' },
    { value: 'contain', label: 'contain (whole image)' },
]
const ASPECTS: SelectOption[] = [
    { value: '', label: '2:3 portrait' },
    { value: '0.75', label: '3:4' },
    { value: '1', label: '1:1 square' },
    { value: '1.333', label: '4:3' },
    { value: '1.5', label: '3:2' },
    { value: '1.778', label: '16:9 wide' },
]

/** Cards view look: what renders inside a card, and how its cover image is framed. */
const CardsFields: Component<CardsFieldsProps> = props => {
    const set = (patch: Partial<CardsLook>) =>
        props.onChange({ ...props.value, ...patch })
    const aspectOptions = () =>
        !props.value.aspect || ASPECTS.some(a => a.value === props.value.aspect)
            ? ASPECTS
            : [
                  ...ASPECTS,
                  { value: props.value.aspect, label: props.value.aspect },
              ]
    return (
        <SettingsGrid class={props.class}>
            <SettingsField label="card shows">
                <Select
                    value={props.value.cardContent}
                    options={CONTENT_OPTS}
                    onChange={cardContent => set({ cardContent })}
                />
            </SettingsField>
            <Show when={props.hasImage}>
                <SettingsField label="image fit">
                    <Select
                        value={props.value.imageFit}
                        options={FIT_OPTS}
                        onChange={imageFit => set({ imageFit })}
                    />
                </SettingsField>
                <SettingsField label="cover shape">
                    <Select
                        value={props.value.aspect}
                        options={aspectOptions()}
                        onChange={aspect => set({ aspect })}
                    />
                </SettingsField>
            </Show>
        </SettingsGrid>
    )
}

export default CardsFields
