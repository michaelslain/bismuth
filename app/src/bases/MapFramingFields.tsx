import { type Component } from 'solid-js'
import { TextInput } from '../ui/TextInput'
import SettingsGrid from '../ui/SettingsGrid'
import SettingsField from '../ui/SettingsField'
import SettingsHint from '../ui/SettingsHint'

export type MapFraming = {
    /** Text as typed; '' = unset. */
    zoom: string
    centerLat: string
    centerLng: string
}

export type MapFramingFieldsProps = {
    value: MapFraming
    onChange: (value: MapFraming) => void
    class?: string
}

/** The map's opening frame (`zoom` + `center`). The view uses it only when BOTH are set;
 *  otherwise it fits itself to the markers. */
const MapFramingFields: Component<MapFramingFieldsProps> = props => {
    const set = (patch: Partial<MapFraming>) =>
        props.onChange({ ...props.value, ...patch })
    return (
        <SettingsGrid class={props.class}>
            <SettingsField label="zoom" badge="optional">
                <TextInput
                    type="number"
                    min="1"
                    max="18"
                    value={props.value.zoom}
                    placeholder="fit to markers"
                    onInput={zoom => set({ zoom })}
                />
            </SettingsField>
            <SettingsField label="center latitude" badge="optional">
                <TextInput
                    type="number"
                    step="any"
                    value={props.value.centerLat}
                    placeholder="e.g. 40.7"
                    onInput={centerLat => set({ centerLat })}
                />
            </SettingsField>
            <SettingsField label="center longitude" badge="optional">
                <TextInput
                    type="number"
                    step="any"
                    value={props.value.centerLng}
                    placeholder="e.g. -74"
                    onInput={centerLng => set({ centerLng })}
                />
            </SettingsField>
            <SettingsHint>
                zoom 1–18. the frame applies only when zoom and both center
                values are set; otherwise the map fits its markers.
            </SettingsHint>
        </SettingsGrid>
    )
}

export default MapFramingFields
