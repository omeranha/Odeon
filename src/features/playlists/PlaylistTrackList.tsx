import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { PlaylistWithSongs, SubsonicSong } from '../../lib/subsonic/types'
import { TrackListHeader, TrackRow, type TrackRowProps } from '../library/TrackList'
import { usePlayerStore } from '../player/playerStore'
import { usePlaylistMutations } from './mutations'

interface KeyedSong {
  key: string
  song: SubsonicSong
}

// Playlists can contain the same song more than once, so sortable ids combine the song id with its occurrence number.
function withKeys(songs: SubsonicSong[]): KeyedSong[] {
  const occurrences = new Map<string, number>()
  return songs.map((song) => {
    const count = (occurrences.get(song.id) ?? 0) + 1
    occurrences.set(song.id, count)
    return { key: `${song.id}#${count}`, song }
  })
}

export function PlaylistTrackList({ playlist, editable }: { playlist: PlaylistWithSongs; editable: boolean }) {
  const songs = playlist.entry ?? []
  const [items, setItems] = useState(() => withKeys(songs))
  const [syncedSongs, setSyncedSongs] = useState(songs)
  if (songs !== syncedSongs) {
    setSyncedSongs(songs)
    setItems(withKeys(songs))
  }

  const { reorder, removeSong } = usePlaylistMutations()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const source = { type: 'playlist' as const, id: playlist.id, name: playlist.name }

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const reordered = arrayMove(
      items,
      items.findIndex((item) => item.key === active.id),
      items.findIndex((item) => item.key === over.id),
    )
    setItems(reordered)
    void reorder(
      playlist.id,
      reordered.map((item) => item.song.id),
    )
  }

  const play = (index: number) =>
    usePlayerStore.getState().playQueue(
      items.map((item) => item.song),
      index,
      source,
    )

  return (
    <div role="table" className="px-2 md:px-4">
      <TrackListHeader showAlbum />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((item) => item.key)} strategy={verticalListSortingStrategy}>
          {items.map((item, index) => (
            <SortableTrackRow
              key={item.key}
              id={item.key}
              editable={editable}
              song={item.song}
              number={index + 1}
              showAlbum
              showCover
              onPlay={() => play(index)}
              extraMenuItems={editable ? [{ label: 'Remove from this playlist', icon: Trash2, onSelect: () => void removeSong(playlist, index) }] : []}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}

function SortableTrackRow({ id, editable, ...rowProps }: TrackRowProps & { id: string; editable: boolean }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !editable })
  const style = { transform: CSS.Translate.toString(transform), transition, position: 'relative' as const, zIndex: isDragging ? 10 : undefined }

  const handle = editable ? (
    <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder ${rowProps.song.title}`} onClick={(event) => event.stopPropagation()} className="cursor-grab touch-none text-subdued hover:text-white active:cursor-grabbing md:opacity-0 md:group-hover:opacity-100">
      <GripVertical className="size-5" />
    </button>
  ) : null

  return <TrackRow {...rowProps} rowRef={setNodeRef} rowStyle={style} dragging={isDragging} dragHandle={handle} />
}
