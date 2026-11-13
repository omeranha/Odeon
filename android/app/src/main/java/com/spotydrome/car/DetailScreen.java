package com.spotydrome.car;

import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.GridView;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

// One page for an album, playlist, artist or Liked Songs: header with actions, then songs (or an artist's albums).
final class DetailScreen extends Screen {

    private final Media.Collection collection;
    private final Runnable downloadListener = this::refreshDownloadState;
    private ImageView cover;
    private TextView title;
    private TextView subtitle;
    private TextView downloadButton;
    private TextView status;
    private ListView songList;
    private GridView albumGrid;
    private Views.SongAdapter songs;
    private Views.TileAdapter albums;
    private Media.Collection loaded;

    DetailScreen(MainActivity activity, Media.Collection collection) {
        super(activity);
        this.collection = collection;
    }

    @Override
    View create() {
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = Ui.dp(activity, 16);
        column.setPadding(padding, padding, padding, 0);

        LinearLayout header = new LinearLayout(activity);
        header.setGravity(Gravity.CENTER_VERTICAL);
        ImageButton back = Ui.iconButton(activity, R.drawable.ic_arrow_back, 56, Ui.RAISED, v -> activity.onBackPressed());
        header.addView(back);
        cover = new ImageView(activity);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setBackground(Ui.rounded(Ui.RAISED, Ui.dp(activity, 8)));
        LinearLayout.LayoutParams coverParams = new LinearLayout.LayoutParams(Ui.dp(activity, 132), Ui.dp(activity, 132));
        coverParams.leftMargin = Ui.dp(activity, 16);
        header.addView(cover, coverParams);

        LinearLayout info = new LinearLayout(activity);
        info.setOrientation(LinearLayout.VERTICAL);
        title = Ui.text(activity, 30, Ui.TEXT, true);
        subtitle = Ui.text(activity, 17, Ui.SUBDUED, false);
        info.addView(title);
        info.addView(subtitle);
        LinearLayout actions = new LinearLayout(activity);
        actions.setPadding(0, Ui.dp(activity, 12), 0, 0);
        actions.addView(Ui.pill(activity, activity.getString(R.string.play), true, v -> playAll(false)));
        actions.addView(Ui.pill(activity, activity.getString(R.string.shuffle), false, v -> playAll(true)));
        downloadButton = Ui.pill(activity, activity.getString(R.string.download), false, v -> toggleDownload());
        actions.addView(downloadButton);
        info.addView(actions);
        status = Ui.text(activity, 14, Ui.SUBDUED, false);
        info.addView(status);
        LinearLayout.LayoutParams infoParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        infoParams.leftMargin = Ui.dp(activity, 20);
        header.addView(info, infoParams);
        column.addView(header);

        songList = new ListView(activity);
        songList.setDivider(null);
        songList.setSelector(android.R.color.transparent);
        boolean mixed = !Media.Collection.ALBUM.equals(collection.kind);
        songs = new Views.SongAdapter(activity, mixed);
        songList.setAdapter(songs);
        songList.setOnItemClickListener((parent, view, position, id) -> PlayerService.playQueue(activity, songs.items(), position));
        LinearLayout.LayoutParams listParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        listParams.topMargin = Ui.dp(activity, 8);
        column.addView(songList, listParams);

        albumGrid = new GridView(activity);
        albumGrid.setColumnWidth(Ui.dp(activity, 180));
        albumGrid.setNumColumns(GridView.AUTO_FIT);
        albumGrid.setStretchMode(GridView.STRETCH_SPACING);
        albumGrid.setVerticalSpacing(Ui.dp(activity, 8));
        albumGrid.setSelector(android.R.color.transparent);
        albums = new Views.TileAdapter(activity, 180);
        albumGrid.setAdapter(albums);
        albumGrid.setOnItemClickListener((parent, view, position, id) -> activity.openCollection(albums.getItem(position)));
        albumGrid.setVisibility(View.GONE);
        column.addView(albumGrid, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        bindHeader(collection);
        return column;
    }

    @Override
    void onShow() {
        DownloadService.addListener(downloadListener);
        refreshDownloadState();
        if (loaded != null) {
            return;
        }
        Library library = Library.get(activity);
        if (!activity.isOnline()) {
            if (library.hasCollection(collection.key())) {
                showSongs(collection, library.songsOf(collection.key()), new ArrayList<>());
            } else {
                status.setText(R.string.not_downloaded_offline);
            }
            return;
        }
        status.setText(R.string.loading);
        Api api = new Api(activity);
        load(() -> api.page(collection), page -> showSongs(page.collection, page.songs, page.albums), error -> {
            if (library.hasCollection(collection.key())) {
                showSongs(collection, library.songsOf(collection.key()), new ArrayList<>());
            } else {
                status.setText(activity.getString(R.string.load_failed, error.getMessage()));
            }
        });
    }

    @Override
    void onHide() {
        DownloadService.removeListener(downloadListener);
    }

    @Override
    void onPlayerChanged() {
        songs.notifyDataSetChanged();
    }

    private void showSongs(Media.Collection header, List<Media.Song> list, List<Media.Collection> albumList) {
        loaded = header;
        bindHeader(header);
        status.setText("");
        songs.set(list);
        if (!albumList.isEmpty()) {
            albums.set(albumList);
            albumGrid.setVisibility(View.VISIBLE);
            songList.setVisibility(View.GONE);
        }
        refreshDownloadState();
    }

    private void bindHeader(Media.Collection header) {
        title.setText(header.name);
        subtitle.setText(header.subtitle);
        if (Media.Collection.LIKED.equals(header.kind)) {
            cover.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
            cover.setImageResource(R.drawable.ic_heart);
            cover.setColorFilter(Ui.ACCENT);
        } else {
            Covers.get(activity).load(cover, header.coverArt, Covers.LARGE, Views.placeholderFor(header));
        }
    }

    private void playAll(boolean shuffled) {
        if (!albums.isEmpty() && songs.isEmpty()) {
            playArtist(shuffled);
            return;
        }
        List<Media.Song> list = new ArrayList<>(songs.items());
        if (list.isEmpty()) {
            return;
        }
        if (shuffled) {
            Collections.shuffle(list);
        }
        PlayerService.playQueue(activity, list, 0);
    }

    private void playArtist(boolean shuffled) {
        Api api = new Api(activity);
        List<Media.Collection> albumList = new ArrayList<>();
        for (int i = 0; i < albums.getCount(); i++) {
            albumList.add(albums.getItem(i));
        }
        status.setText(R.string.loading);
        load(() -> {
            List<Media.Song> all = new ArrayList<>();
            for (Media.Collection album : albumList) {
                all.addAll(api.page(album).songs);
            }
            return all;
        }, all -> {
            status.setText("");
            if (shuffled) {
                Collections.shuffle(all);
            }
            if (!all.isEmpty()) {
                PlayerService.playQueue(activity, all, 0);
            }
        }, null);
    }

    private void toggleDownload() {
        Media.Collection target = loaded != null ? loaded : collection;
        Library library = Library.get(activity);
        if (library.hasCollection(target.key())) {
            library.removeCollection(target.key());
            activity.toast(activity.getString(R.string.download_removed, target.name));
            songs.notifyDataSetChanged();
            refreshDownloadState();
            return;
        }
        if (!activity.isOnline()) {
            activity.toast(activity.getString(R.string.needs_connection));
            return;
        }
        library.saveCollection(target, songs.items());
        DownloadService.download(activity, target);
        activity.toast(activity.getString(R.string.download_started, target.name));
        refreshDownloadState();
    }

    private void refreshDownloadState() {
        Media.Collection target = loaded != null ? loaded : collection;
        Library library = Library.get(activity);
        boolean saved = library.hasCollection(target.key());
        downloadButton.setText(saved ? R.string.remove_download : R.string.download);
        if (saved) {
            int[] progress = library.progressOf(target.key());
            if (progress[1] > 0 && progress[0] < progress[1]) {
                status.setText(activity.getString(R.string.downloaded_count, progress[0], progress[1]));
            } else if (progress[1] > 0) {
                status.setText(R.string.downloaded_all);
            }
        }
        songs.notifyDataSetChanged();
    }
}
