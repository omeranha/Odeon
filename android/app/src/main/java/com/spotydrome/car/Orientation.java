package com.spotydrome.car;

import android.app.Activity;
import android.content.Context;
import android.content.pm.ActivityInfo;
import android.provider.Settings;
import android.view.Surface;

// The tablet is mounted upside down in the car. DLdash flips its own screen and pins the system rotation for other
// apps; that pin can get reset, so this app keeps its own setting, defaulting to whatever the pin says.
final class Orientation {

    private Orientation() {
    }

    static boolean systemPinnedUpsideDown(Context context) {
        int auto = Settings.System.getInt(context.getContentResolver(), Settings.System.ACCELEROMETER_ROTATION, 1);
        int rotation = Settings.System.getInt(context.getContentResolver(), Settings.System.USER_ROTATION, Surface.ROTATION_0);
        return auto == 0 && rotation == Surface.ROTATION_270;
    }

    static void apply(Activity activity) {
        int orientation = new Prefs(activity).flipScreen() ? ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE;
        if (activity.getRequestedOrientation() != orientation) {
            activity.setRequestedOrientation(orientation);
        }
    }
}
