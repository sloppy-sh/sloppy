package sh.sloppy.app

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /** Back belongs to the app first — `src/routes/+layout.svelte` answers, and
   *  cancelling the event is how it says it took the press. TauriActivity turns
   *  wry's own handler off, so without this the press finishes the activity. */
  override fun onWebViewCreate(webView: WebView) {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript(
          "!window.dispatchEvent(new Event('sloppy:back', { cancelable: true }))"
        ) { answered ->
          if (answered != "true") {
            isEnabled = false
            onBackPressedDispatcher.onBackPressed()
            isEnabled = true
          }
        }
      }
    })
  }
}
