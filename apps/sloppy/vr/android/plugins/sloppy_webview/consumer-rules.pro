# Godot finds the plugin by name and calls its methods by reflection.
-keep class sh.sloppy.webview.SloppyWebView { *; }
-keepclassmembers class sh.sloppy.webview.** {
    @android.webkit.JavascriptInterface <methods>;
}
