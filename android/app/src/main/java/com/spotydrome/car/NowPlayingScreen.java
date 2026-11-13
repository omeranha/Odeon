package com.spotydrome.car;

import android.os.Handler;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;

final class NowPlayingScreen extends Screen {

    private static final long TICK_MS = 500;

    private final Handler handler = new Handler();
    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            updatePosition();
            handler.postDelayed(this, TICK_MS);
        }
    };
    private ImageView cover;
    private TextView title;
    private TextView artist;
    private TextView album;
    private SeekBar seek;
    private TextView elapsed;
    private TextView total;
    private ImageButton play;
    private ImageButton shuffle;
    private ImageButton repeat;
    private boolean dragging;
    private String shownCover;

    NowPlayingScreen(MainActivity activity) {
        super(activity);
    }

    @Override
    View create() {
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.HORIZONTAL);
        root.setGravity(Gravity.CENTER_VERTICAL);
        int padding = Ui.dp(activity, 20);
        root.setPadding(padding, padding, padding, padding);

        LinearLayout left = new LinearLayout(activity);
        left.setOrientation(LinearLayout.VERTICAL);
        left.addView(Ui.iconButton(activity, R.drawable.ic_arrow_back, 56, Ui.RAISED, v -> activity.onBackPressed()));
        root.addView(left, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.MATCH_PARENT));

        cover = new ImageView(activity);
        cover.setScaleType(ImageView.ScaleType.CENTER_CROP);
        cover.setBackground(Ui.rounded(Ui.RAISED, Ui.dp(activity, 12)));
        LinearLayout.LayoutParams coverParams = new LinearLayout.LayoutParams(Ui.dp(activity, 300), Ui.dp(activity, 300));
        coverParams.leftMargin = Ui.dp(activity, 16);
        root.addView(cover, coverParams);

        LinearLayout right = new LinearLayout(activity);
        right.setOrientation(LinearLayout.VERTICAL);
        right.setGravity(Gravity.CENTER_VERTICAL);
        title = Ui.text(activity, 32, Ui.TEXT, true);
        artist = Ui.text(activity, 22, Ui.SUBDUED, false);
        album = Ui.text(activity, 17, Ui.SUBDUED, false);
        right.addView(title);
        right.addView(artist);
        right.addView(album);

        seek = new SeekBar(activity);
        seek.setProgressDrawable(activity.getResources().getDrawable(R.drawable.seek_progress));
        seek.setThumb(activity.getResources().getDrawable(R.drawable.seek_thumb));
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
                if (fromUser) {
                    elapsed.setText(Ui.time(progress));
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar bar) {
                dragging = true;
            }

            @Override
            public void onStopTrackingTouch(SeekBar bar) {
                dragging = false;
                PlayerService player = PlayerService.current();
                if (player != null) {
                    player.seekTo(bar.getProgress());
                }
            }
        });
        LinearLayout.LayoutParams seekParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Ui.dp(activity, 48));
        seekParams.topMargin = Ui.dp(activity, 24);
        right.addView(seek, seekParams);
        LinearLayout times = new LinearLayout(activity);
        elapsed = Ui.text(activity, 15, Ui.SUBDUED, false);
        total = Ui.text(activity, 15, Ui.SUBDUED, false);
        total.setGravity(Gravity.RIGHT);
        times.addView(elapsed, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        times.addView(total, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        int inset = Ui.dp(activity, 16);
        times.setPadding(inset, 0, inset, 0);
        right.addView(times);

        LinearLayout controls = new LinearLayout(activity);
        controls.setGravity(Gravity.CENTER);
        controls.setPadding(0, Ui.dp(activity, 20), 0, 0);
        shuffle = Ui.iconButton(activity, R.drawable.ic_shuffle, 56, Ui.BACKGROUND, v -> withPlayer(PlayerService::toggleShuffle));
        controls.addView(shuffle);
        controls.addView(spaced(Ui.iconButton(activity, R.drawable.ic_skip_previous, 72, Ui.RAISED, v -> PlayerService.previous(activity))));
        play = Ui.iconButton(activity, R.drawable.ic_play, 92, Ui.ACCENT, v -> PlayerService.toggle(activity));
        controls.addView(spaced(play));
        controls.addView(spaced(Ui.iconButton(activity, R.drawable.ic_skip_next, 72, Ui.RAISED, v -> PlayerService.next(activity))));
        repeat = Ui.iconButton(activity, R.drawable.ic_repeat, 56, Ui.BACKGROUND, v -> withPlayer(PlayerService::cycleRepeat));
        controls.addView(spaced(repeat));
        controls.addView(spaced(Ui.iconButton(activity, R.drawable.ic_queue, 56, Ui.BACKGROUND, v -> activity.open(new QueueScreen(activity)))));
        right.addView(controls);

        LinearLayout.LayoutParams rightParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f);
        rightParams.leftMargin = Ui.dp(activity, 24);
        root.addView(right, rightParams);
        return root;
    }

    private View spaced(View view) {
        ((LinearLayout.LayoutParams) view.getLayoutParams()).leftMargin = Ui.dp(activity, 10);
        return view;
    }

    private interface PlayerAction {
        void apply(PlayerService player);
    }

    private void withPlayer(PlayerAction action) {
        PlayerService player = PlayerService.current();
        if (player != null) {
            action.apply(player);
        }
    }

    @Override
    void onShow() {
        onPlayerChanged();
        handler.post(tick);
    }

    @Override
    void onHide() {
        handler.removeCallbacks(tick);
    }

    @Override
    void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    void onPlayerChanged() {
        PlayerService player = PlayerService.current();
        Media.Song song = player == null ? null : player.song();
        if (song == null) {
            return;
        }
        title.setText(song.title);
        artist.setText(song.artist);
        album.setText(song.album);
        if (!song.id.equals(shownCover)) {
            shownCover = song.id;
            Covers.get(activity).load(cover, song, Covers.LARGE, R.drawable.ic_music_note);
        }
        play.setImageResource(player.isPlaying() ? R.drawable.ic_pause : R.drawable.ic_play);
        Ui.setToggle(shuffle, player.isShuffle());
        Ui.setToggle(repeat, player.repeatMode() != PlayerService.REPEAT_OFF);
        repeat.setAlpha(player.repeatMode() == PlayerService.REPEAT_ONE ? 0.6f : 1f);
        updatePosition();
    }

    private void updatePosition() {
        PlayerService player = PlayerService.current();
        if (player == null || dragging) {
            return;
        }
        int duration = player.durationMs();
        int position = Math.min(player.positionMs(), duration);
        seek.setMax(Math.max(1, duration));
        seek.setProgress(position);
        elapsed.setText(player.isLoading() ? activity.getString(R.string.loading) : Ui.time(position));
        total.setText(Ui.time(duration));
    }
}
