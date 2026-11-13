package com.spotydrome.car;

import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

final class QueueScreen extends Screen {

    private Views.SongAdapter adapter;

    QueueScreen(MainActivity activity) {
        super(activity);
    }

    @Override
    View create() {
        LinearLayout column = new LinearLayout(activity);
        column.setOrientation(LinearLayout.VERTICAL);
        int padding = Ui.dp(activity, 16);
        column.setPadding(padding, padding, padding, 0);
        LinearLayout header = new LinearLayout(activity);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.addView(Ui.iconButton(activity, R.drawable.ic_arrow_back, 56, Ui.RAISED, v -> activity.onBackPressed()));
        TextView title = Ui.text(activity, 28, Ui.TEXT, true);
        title.setText(R.string.queue);
        title.setPadding(Ui.dp(activity, 16), 0, 0, 0);
        header.addView(title);
        column.addView(header);
        ListView list = new ListView(activity);
        list.setDivider(null);
        list.setSelector(android.R.color.transparent);
        adapter = new Views.SongAdapter(activity, true);
        list.setAdapter(adapter);
        list.setOnItemClickListener((parent, view, position, id) -> {
            PlayerService player = PlayerService.current();
            if (player != null) {
                player.jumpTo(position);
            }
        });
        LinearLayout.LayoutParams listParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f);
        listParams.topMargin = Ui.dp(activity, 8);
        column.addView(list, listParams);
        return column;
    }

    @Override
    void onShow() {
        onPlayerChanged();
    }

    @Override
    void onPlayerChanged() {
        PlayerService player = PlayerService.current();
        if (player != null) {
            adapter.set(player.upcoming());
        }
    }
}
