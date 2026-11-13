package com.spotydrome.car;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.view.KeyEvent;

// Receives play/pause/next/previous from DLdash's home screen, Bluetooth and steering-wheel buttons.
public final class MediaButtonReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        KeyEvent event = intent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
        if (event == null || event.getAction() != KeyEvent.ACTION_DOWN || event.getRepeatCount() > 0) {
            return;
        }
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK:
            case KeyEvent.KEYCODE_MEDIA_PLAY:
            case KeyEvent.KEYCODE_MEDIA_PAUSE:
                PlayerService.toggle(context);
                break;
            case KeyEvent.KEYCODE_MEDIA_NEXT:
                PlayerService.next(context);
                break;
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS:
                PlayerService.previous(context);
                break;
            default:
                return;
        }
        if (isOrderedBroadcast()) {
            abortBroadcast();
        }
    }
}
