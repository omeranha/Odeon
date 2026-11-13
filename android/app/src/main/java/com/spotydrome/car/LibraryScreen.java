package com.spotydrome.car;

import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.GridView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

final class LibraryScreen extends Screen {

    private static final int PLAYLISTS = 0;
    private static final int ALBUMS = 1;
    private static final int ARTISTS = 2;
    private static final int PAGE_SIZE = 60;
    private static final int TILE_DP = 180;

    private final TextView[] chips = new TextView[3];
    private Views.TileAdapter adapter;
    private TextView empty;
    private int section = PLAYLISTS;
    private int generation;
    private boolean loadingMore;
    private boolean endReached;
    private Boolean shownOnline;

    LibraryScreen(MainActivity activity) {
        super(activity);
    }

    @Override
    View create() {
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = Ui.dp(activity, 16);
        column.setPadding(padding, padding, padding, 0);

        LinearLayout chipRow = new LinearLayout(activity);
        int[] labels = {R.string.playlists, R.string.albums, R.string.artists};
        for (int i = 0; i < chips.length; i++) {
            int index = i;
            chips[i] = Ui.pill(activity, activity.getString(labels[i]), false, v -> select(index));
            chipRow.addView(chips[i]);
        }
        column.addView(chipRow);

        empty = Views.message(activity, "");
        empty.setVisibility(View.GONE);
        column.addView(empty);

        GridView grid = new GridView(activity);
        grid.setColumnWidth(Ui.dp(activity, TILE_DP));
        grid.setNumColumns(GridView.AUTO_FIT);
        grid.setStretchMode(GridView.STRETCH_SPACING);
        grid.setVerticalSpacing(Ui.dp(activity, 8));
        grid.setSelector(android.R.color.transparent);
        grid.setPadding(0, Ui.dp(activity, 12), 0, Ui.dp(activity, 12));
        grid.setClipToPadding(false);
        adapter = new Views.TileAdapter(activity, TILE_DP);
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((parent, view, position, id) -> activity.openCollection(adapter.getItem(position)));
        grid.setOnScrollListener(new AbsListView.OnScrollListener() {
            @Override
            public void onScrollStateChanged(AbsListView view, int scrollState) {
            }

            @Override
            public void onScroll(AbsListView view, int first, int visible, int total) {
                if (section == ALBUMS && !loadingMore && !endReached && total > 0 && first + visible >= total - 6) {
                    loadAlbums(adapter.getCount());
                }
            }
        });
        column.addView(grid, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        return column;
    }

    @Override
    void onShow() {
        boolean online = activity.isOnline();
        if (shownOnline != null && shownOnline == online) {
            return;
        }
        shownOnline = online;
        select(section);
    }

    private void select(int index) {
        section = index;
        for (int i = 0; i < chips.length; i++) {
            chips[i].setBackground(Ui.pressable(i == index ? Ui.TEXT : Ui.RAISED, Ui.PRESSED, Ui.dp(activity, 28)));
            chips[i].setTextColor(i == index ? Ui.ON_ACCENT : Ui.TEXT);
        }
        int current = ++generation;
        adapter.set(new ArrayList<>());
        endReached = false;
        loadingMore = false;
        if (!activity.isOnline()) {
            List<Media.Collection> saved = new ArrayList<>();
            for (Media.Collection collection : Library.get(activity).collections()) {
                boolean matches = index == PLAYLISTS ? Media.Collection.PLAYLIST.equals(collection.kind) || Media.Collection.LIKED.equals(collection.kind) : index == ALBUMS ? Media.Collection.ALBUM.equals(collection.kind) : Media.Collection.ARTIST.equals(collection.kind);
                if (matches) {
                    saved.add(collection);
                }
            }
            showResult(saved, activity.getString(R.string.nothing_downloaded_here));
            return;
        }
        showEmpty(activity.getString(R.string.loading));
        Api api = new Api(activity);
        if (index == ALBUMS) {
            loadAlbums(0);
            return;
        }
        load(() -> {
            if (index == ARTISTS) {
                return api.artists();
            }
            List<Media.Collection> playlists = new ArrayList<>();
            playlists.add(Media.Collection.liked());
            playlists.addAll(api.playlists());
            return playlists;
        }, result -> {
            if (current == generation) {
                showResult(result, activity.getString(R.string.nothing_here));
            }
        }, error -> showEmpty(activity.getString(R.string.load_failed, error.getMessage())));
    }

    private void loadAlbums(int offset) {
        int current = generation;
        loadingMore = true;
        Api api = new Api(activity);
        load(() -> api.albumList("alphabeticalByName", PAGE_SIZE, offset), result -> {
            if (current != generation) {
                return;
            }
            loadingMore = false;
            endReached = result.size() < PAGE_SIZE;
            if (offset == 0) {
                showResult(result, activity.getString(R.string.nothing_here));
            } else {
                adapter.add(result);
            }
        }, error -> {
            loadingMore = false;
            showEmpty(activity.getString(R.string.load_failed, error.getMessage()));
        });
    }

    private void showResult(List<Media.Collection> result, String emptyText) {
        adapter.set(result);
        if (result.isEmpty()) {
            showEmpty(emptyText);
        } else {
            empty.setVisibility(View.GONE);
        }
    }

    private void showEmpty(String text) {
        empty.setText(text);
        empty.setVisibility(View.VISIBLE);
    }
}
