LOCAL_PATH := $(call my-dir)
include $(CLEAR_VARS)
LOCAL_MODULE := sloppy_webview
LOCAL_SRC_FILES := held_buffer.c
LOCAL_LDLIBS := -landroid
include $(BUILD_SHARED_LIBRARY)
