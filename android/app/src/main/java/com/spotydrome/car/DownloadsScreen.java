package com.spotydrome.car;

import android.view.View;
import android.view.ViewGroup;
import android.widget.GridView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

final class DownloadsScreen extends Screen {

    private final Runnable downloadListener = this::refresh;
    private TextView summary;
    private TextView status;
    private TextView empty;
    private Views.TileAdapter adapter;

    DownloadsScreen(MainActivity activity) {
        super(activity);
    }

    @Override
    View create() {
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = Ui.dp(activity, 16);
        column.setPadding(padding, padding, padding, 0);

        TextView heading = Ui.text(activity, 28, Ui.TEXT, true);
        heading.setText(R.string.tab_downloads);
        column.addView(heading);
        summary = Ui.text(activity, 16, Ui.SUBDUED, false);
        column.addView(summary);

        LinearLayout actions = new LinearLayout(activity);
        actions.setPadding(0, Ui.dp(activity, 12), 0, Ui.dp(activity, 4));
        actions.addView(Ui.pill(activity, activity.getString(R.string.shuffle_downloads), true, v -> shuffleAll()));
        actions.addView(Ui.pill(activity, activity.getString(R.string.update_all), false, v -> updateAll()));
        actions.addView(Ui.pill(activity, activity.getString(R.string.cancel), false, v -> DownloadService.cancel(activity)));
        column.addView(actions);
        status = Ui.text(activity, 15, Ui.ACCENT, false);
        column.addView(status);

        empty = Views.message(activity, activity.getString(R.string.downloads_empty));
        column.addView(empty);

        GridView grid = new GridView(activity);
        grid.setColumnWidth(Ui.dp(activity, 180));
        grid.setNumColumns(GridView.AUTO_FIT);
        grid.setStretchMode(GridView.STRETCH_SPACING);
        grid.setVerticalSpacing(Ui.dp(activity, 8));
        grid.setSelector(android.R.color.transparent);
        adapter = new Views.TileAdapter(activity, 180);
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((parent, view, position, id) -> activity.openCollection(adapter.getItem(position)));
        LinearLayout.LayoutParams gridParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        gridParams.topMargin = Ui.dp(activity, 8);
        column.addView(grid, gridParams);
        return column;
    }

    @Override
    void onShow() {
        DownloadService.addListener(downloadListener);
        refresh();
    }

    @Override
    void onHide() {
        DownloadService.removeListener(downloadListener);
    }

    private void refresh() {
        Library library = Library.get(activity);
        List<Media.Collection> saved = new ArrayList<>();
        for (Media.Collection collection : library.collections()) {
            int[] progress = library.progressOf(collection.key());
            String detail = progress[0] < progress[1] ? activity.getString(R.string.downloaded_count, progress[0], progress[1]) : activity.getString(R.string.songs_count, progress[1]);
            saved.add(new Media.Collection(collection.kind, collection.id, collection.name, detail, collection.coverArt));
        }
        adapter.set(saved);
        empty.setVisibility(saved.isEmpty() ? View.VISIBLE : View.GONE);
        String location = library.storageDir().getAbsolutePath();
        summary.setText(activity.getString(R.string.downloads_summary, library.downloadedSongs().size(), Ui.size(library.usedBytes()), location));
        status.setText(DownloadService.status());
    }

    private void shuffleAll() {
        List<Media.Song> all = Library.get(activity).downloadedSongs();
        if (all.isEmpty()) {
            activity.toast(activity.getString(R.string.downloads_empty));
            return;
        }
        Collections.shuffle(all);
        PlayerService.playQueue(activity, all, 0);
    }

    private void updateAll() {
        if (!activity.isOnline()) {
            activity.toast(activity.getString(R.string.needs_connection));
            return;
        }
        DownloadService.syncAll(activity);
    }
}
