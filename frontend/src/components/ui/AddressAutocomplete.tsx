import { useEffect, useRef, useState } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

interface Props {
  value: string
  onChange: (value: string) => void
  className?: string
  placeholder?: string
  name?: string
}

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined

let loadPromise: Promise<google.maps.PlacesLibrary> | undefined

function loadPlaces(): Promise<google.maps.PlacesLibrary> {
  if (!loadPromise) {
    setOptions({ key: API_KEY ?? '', libraries: ['places'], v: 'weekly' })
    loadPromise = importLibrary('places') as Promise<google.maps.PlacesLibrary>
  }
  return loadPromise
}

export default function AddressAutocomplete({ value, onChange, className, placeholder, name }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!API_KEY) return
    loadPlaces().then(() => setReady(true))
  }, [])

  useEffect(() => {
    if (!ready || !inputRef.current || autocompleteRef.current) return

    autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      fields: ['formatted_address'],
    })

    autocompleteRef.current.addListener('place_changed', () => {
      const place = autocompleteRef.current?.getPlace()
      if (place?.formatted_address) {
        onChange(place.formatted_address)
      }
    })
  }, [ready, onChange])

  return (
    <input
      ref={inputRef}
      type="text"
      name={name}
      value={value}
      onChange={e => onChange(e.target.value)}
      className={className}
      placeholder={placeholder}
      autoComplete="off"
    />
  )
}
