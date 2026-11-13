package com.spotydrome.car;

import android.view.View;
import android.widget.LinearLayout;
import android.widget.ScrollView;

import java.util.ArrayList;
import java.util.List;

final class HomeScreen extends Screen {

    private static final int SHELF_SIZE = 14;

    private LinearLayout column;
    private Boolean shownOnline;

    HomeScreen(MainActivity activity) {
        super(activity);
    }

    @Override
    View create() {
        ScrollView scroll = new ScrollView(activity);
        column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = Ui.dp(activity, 16);
        column.setPadding(padding, 0, padding, padding);
        scroll.addView(column);
        return scroll;
    }

    @Override
    void onShow() {
        boolean online = activity.isOnline();
        if (shownOnline != null && shownOnline == online) {
            return;
        }
        shownOnline = online;
        column.removeAllViews();
        if (!online) {
            showDownloaded();
            return;
        }
        column.addView(Views.message(activity, activity.getString(R.string.loading)));
        Api api = new Api(activity);
        load(() -> {
            List<List<Media.Collection>> shelves = new ArrayList<>();
            List<Media.Collection> playlists = new ArrayList<>();
            playlists.add(Media.Collection.liked());
            playlists.addAll(api.playlists());
            shelves.add(playlists);
            shelves.add(api.albumList("recent", SHELF_SIZE, 0));
            shelves.add(api.albumList("newest", SHELF_SIZE, 0));
            shelves.add(api.albumList("frequent", SHELF_SIZE, 0));
            return shelves;
        }, shelves -> {
            column.removeAllViews();
            int[] titles = {R.string.shelf_playlists, R.string.shelf_recent, R.string.shelf_new, R.string.shelf_frequent};
            for (int i = 0; i < shelves.size(); i++) {
                if (!shelves.get(i).isEmpty()) {
                    column.addView(Views.shelf(activity, activity.getString(titles[i]), shelves.get(i), activity::openCollection));
                }
            }
        }, error -> {
            shownOnline = null;
            column.removeAllViews();
            column.addView(Views.message(activity, activity.getString(R.string.load_failed, error.getMessage())));
            showDownloaded();
        });
    }

    private void showDownloaded() {
        List<Media.Collection> saved = Library.get(activity).collections();
        if (saved.isEmpty()) {
            column.addView(Views.message(activity, activity.getString(R.string.nothing_downloaded)));
        } else {
            column.addView(Views.shelf(activity, activity.getString(R.string.shelf_downloaded), saved, activity::openCollection));
        }
    }
}
