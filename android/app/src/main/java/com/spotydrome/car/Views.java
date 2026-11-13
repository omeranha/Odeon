package com.spotydrome.car;

import android.content.Context;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

// Reusable pieces: collection tiles, song rows and their adapters.
final class Views {

    interface OnCollection {
        void open(Media.Collection collection);
    }

    interface OnSong {
        void play(List<Media.Song> songs, int index);
    }

    private Views() {
    }

    static int placeholderFor(Media.Collection collection) {
        switch (collection.kind) {
            case Media.Collection.LIKED:
                return R.drawable.ic_heart;
            case Media.Collection.PLAYLIST:
                return R.drawable.ic_queue;
            default:
                return R.drawable.ic_music_note;
        }
    }

    static final class TileHolder {
        final ImageView cover;
        final TextView name;
        final TextView subtitle;

        TileHolder(View root) {
            ViewGroup group = (ViewGroup) root;
            cover = (ImageView) group.getChildAt(0);
            name = (TextView) group.getChildAt(1);
            subtitle = (TextView) group.getChildAt(2);
        }
    }

    static View tile(Context context, int widthDp) {
        LinearLayout tile = new LinearLayout(context);
        tile.setOrientation(LinearLayout.VERTICAL);
        int padding = Ui.dp(context, 10);
        tile.setPadding(padding, padding, padding, padding);
        tile.setBackground(Ui.pressable(Ui.SURFACE, Ui.PRESSED, Ui.dp(context, 10)));
        int coverSize = Ui.dp(context, widthDp - 20);
        ImageView cover = new ImageView(context);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setBackground(Ui.rounded(Ui.RAISED, Ui.dp(context, 6)));
        tile.addView(cover, new LinearLayout.LayoutParams(coverSize, coverSize));
        TextView name = Ui.text(context, 16, Ui.TEXT, true);
        LinearLayout.LayoutParams nameParams = new LinearLayout.LayoutParams(coverSize, ViewGroup.LayoutParams.WRAP_CONTENT);
        nameParams.topMargin = Ui.dp(context, 8);
        tile.addView(name, nameParams);
        TextView subtitle = Ui.text(context, 14, Ui.SUBDUED, false);
        tile.addView(subtitle, new LinearLayout.LayoutParams(coverSize, ViewGroup.LayoutParams.WRAP_CONTENT));
        tile.setTag(new TileHolder(tile));
        return tile;
    }

    static void bindTile(View tile, Media.Collection collection) {
        TileHolder holder = (TileHolder) tile.getTag();
        holder.name.setText(collection.name);
        holder.subtitle.setText(collection.subtitle);
        int placeholder = placeholderFor(collection);
        if (Media.Collection.LIKED.equals(collection.kind)) {
            holder.cover.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
            holder.cover.setImageResource(placeholder);
            holder.cover.setColorFilter(Ui.ACCENT);
            holder.cover.setTag(R.id.cover_key, null);
        } else {
            holder.cover.clearColorFilter();
            holder.cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
            Covers.get(tile.getContext()).load(holder.cover, collection.coverArt, Covers.SMALL, placeholder);
        }
    }

    // A horizontal row of tiles for the home and search pages.
    static View shelf(Context context, String title, List<Media.Collection> collections, OnCollection onOpen) {
        LinearLayout section = new LinearLayout(context);
        section.setOrientation(LinearLayout.VERTICAL);
        section.addView(sectionHeader(context, title));
        HorizontalScrollView scroller = new HorizontalScrollView(context);
        scroller.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(context);
        row.setOrientation(LinearLayout.HORIZONTAL);
        for (Media.Collection collection : collections) {
            View tile = tile(context, 170);
            bindTile(tile, collection);
            tile.setOnClickListener(v -> onOpen.open(collection));
            LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            params.rightMargin = Ui.dp(context, 8);
            row.addView(tile, params);
        }
        scroller.addView(row);
        section.addView(scroller);
        return section;
    }

    static TextView sectionHeader(Context context, String title) {
        TextView header = Ui.text(context, 22, Ui.TEXT, true);
        header.setText(title);
        header.setPadding(Ui.dp(context, 8), Ui.dp(context, 16), 0, Ui.dp(context, 8));
        return header;
    }

    static final class TileAdapter extends BaseAdapter {
        private final Context context;
        private final int widthDp;
        private final List<Media.Collection> items = new ArrayList<>();

        TileAdapter(Context context, int widthDp) {
            this.context = context;
            this.widthDp = widthDp;
        }

        void set(List<Media.Collection> collections) {
            items.clear();
            items.addAll(collections);
            notifyDataSetChanged();
        }

        void add(List<Media.Collection> collections) {
            items.addAll(collections);
            notifyDataSetChanged();
        }

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public Media.Collection getItem(int position) {
            return items.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            View tile = convertView != null ? convertView : tile(context, widthDp);
            bindTile(tile, items.get(position));
            return tile;
        }
    }

    // A song row. Songs not in the library yet show an "add to library" button instead of the downloaded mark.
    static final class SongRow {
        final LinearLayout root;
        final View lead;
        final TextView title;
        final TextView detail;
        final ImageView downloaded;
        final ImageView add;
        final TextView duration;

        SongRow(Context context, boolean showCovers) {
            root = new LinearLayout(context);
            root.setOrientation(LinearLayout.HORIZONTAL);
            root.setGravity(Gravity.CENTER_VERTICAL);
            root.setMinimumHeight(Ui.dp(context, 64));
            int padding = Ui.dp(context, 10);
            root.setPadding(padding, Ui.dp(context, 6), padding, Ui.dp(context, 6));
            root.setBackground(Ui.pressable(0x00000000, Ui.PRESSED, Ui.dp(context, 8)));
            root.setLayoutParams(new AbsListView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            if (showCovers) {
                ImageView cover = new ImageView(context);
                cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
                cover.setBackground(Ui.rounded(Ui.RAISED, Ui.dp(context, 4)));
                lead = cover;
                root.addView(cover, new LinearLayout.LayoutParams(Ui.dp(context, 52), Ui.dp(context, 52)));
            } else {
                TextView number = Ui.text(context, 16, Ui.SUBDUED, false);
                number.setGravity(Gravity.CENTER);
                lead = number;
                root.addView(number, new LinearLayout.LayoutParams(Ui.dp(context, 40), ViewGroup.LayoutParams.WRAP_CONTENT));
            }
            LinearLayout texts = new LinearLayout(context);
            texts.setOrientation(LinearLayout.VERTICAL);
            title = Ui.text(context, 18, Ui.TEXT, false);
            detail = Ui.text(context, 14, Ui.SUBDUED, false);
            texts.addView(title);
            texts.addView(detail);
            LinearLayout.LayoutParams textParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            textParams.leftMargin = Ui.dp(context, 14);
            root.addView(texts, textParams);
            downloaded = new ImageView(context);
            downloaded.setImageResource(R.drawable.ic_downloaded);
            downloaded.setColorFilter(Ui.ACCENT);
            root.addView(downloaded, new LinearLayout.LayoutParams(Ui.dp(context, 22), Ui.dp(context, 22)));
            add = new ImageView(context);
            add.setImageResource(R.drawable.ic_add);
            int addPadding = Ui.dp(context, 10);
            add.setPadding(addPadding, addPadding, addPadding, addPadding);
            add.setBackground(Ui.pressable(Ui.RAISED, Ui.PRESSED, Ui.dp(context, 22)));
            add.setFocusable(false);
            add.setVisibility(View.GONE);
            root.addView(add, new LinearLayout.LayoutParams(Ui.dp(context, 44), Ui.dp(context, 44)));
            duration = Ui.text(context, 15, Ui.SUBDUED, false);
            duration.setGravity(Gravity.RIGHT);
            root.addView(duration, new LinearLayout.LayoutParams(Ui.dp(context, 64), ViewGroup.LayoutParams.WRAP_CONTENT));
            root.setTag(this);
        }

        void bind(Context context, Media.Song song, int position, OnAdd onAdd) {
            PlayerService player = PlayerService.current();
            Media.Song current = player == null ? null : player.song();
            boolean isCurrent = current != null && current.id.equals(song.id);
            if (lead instanceof ImageView) {
                Covers.get(context).load((ImageView) lead, song, Covers.SMALL, R.drawable.ic_music_note);
            } else {
                ((TextView) lead).setText(String.valueOf(position + 1));
            }
            title.setText(song.title);
            title.setTextColor(isCurrent ? Ui.ACCENT : Ui.TEXT);
            detail.setText(song.album.isEmpty() ? song.artist : song.artist + " • " + song.album);
            downloaded.setVisibility(!song.isExternal() && Library.get(context).isDownloaded(song.id) ? View.VISIBLE : View.INVISIBLE);
            add.setVisibility(song.isExternal() && onAdd != null ? View.VISIBLE : View.GONE);
            add.setOnClickListener(onAdd == null ? null : v -> onAdd.add(song));
            duration.setText(song.durationSeconds > 0 ? Ui.time(song.durationSeconds * 1000) : "");
        }
    }

    interface OnAdd {
        void add(Media.Song song);
    }

    static final class SongAdapter extends BaseAdapter {
        private final Context context;
        private final boolean showCovers;
        private final List<Media.Song> items = new ArrayList<>();

        SongAdapter(Context context, boolean showCovers) {
            this.context = context;
            this.showCovers = showCovers;
        }

        void set(List<Media.Song> songs) {
            items.clear();
            items.addAll(songs);
            notifyDataSetChanged();
        }

        List<Media.Song> items() {
            return items;
        }

        @Override
        public int getCount() {
            return items.size();
        }

        @Override
        public Media.Song getItem(int position) {
            return items.get(position);
        }

        @Override
        public long getItemId(int position) {
            return position;
        }

        @Override
        public View getView(int position, View convertView, ViewGroup parent) {
            SongRow row = convertView == null ? new SongRow(context, showCovers) : (SongRow) convertView.getTag();
            row.bind(context, items.get(position), position, null);
            return row.root;
        }
    }

    static TextView message(Context context, String text) {
        TextView view = Ui.text(context, 18, Ui.SUBDUED, false);
        view.setSingleLine(false);
        view.setGravity(Gravity.CENTER);
        view.setText(text);
        int padding = Ui.dp(context, 32);
        view.setPadding(padding, padding, padding, padding);
        return view;
    }
}
