#include <CoreFoundation/CoreFoundation.h>
#include <CoreGraphics/CoreGraphics.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

static int64_t dictionary_integer(CFDictionaryRef dictionary, const void *key, int64_t fallback) {
  CFNumberRef value = CFDictionaryGetValue(dictionary, key);
  int64_t result = fallback;
  if (value && CFGetTypeID(value) == CFNumberGetTypeID()) {
    CFNumberGetValue(value, kCFNumberSInt64Type, &result);
  }
  return result;
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "Usage: front-window-id <pid>\n");
    return 2;
  }
  char *end = NULL;
  errno = 0;
  long parsed = strtol(argv[1], &end, 10);
  if (errno || !end || *end != '\0' || parsed < 1 || parsed > INT32_MAX) {
    fprintf(stderr, "PID must be a positive integer.\n");
    return 2;
  }

  CFArrayRef windows = CGWindowListCopyWindowInfo(
    kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
    kCGNullWindowID
  );
  if (!windows) {
    fprintf(stderr, "The visible window list is unavailable; confirm Screen Recording permission.\n");
    return 1;
  }

  CFIndex count = CFArrayGetCount(windows);
  for (CFIndex index = 0; index < count; index += 1) {
    CFDictionaryRef window = (CFDictionaryRef)CFArrayGetValueAtIndex(windows, index);
    int64_t owner_pid = dictionary_integer(window, kCGWindowOwnerPID, -1);
    int64_t layer = dictionary_integer(window, kCGWindowLayer, -1);
    int64_t window_id = dictionary_integer(window, kCGWindowNumber, -1);
    if (owner_pid == parsed && layer == 0 && window_id > 0) {
      printf("%lld\n", window_id);
      CFRelease(windows);
      return 0;
    }
  }

  CFRelease(windows);
  fprintf(stderr, "No visible layer-zero ChatGPT window was found for PID %ld.\n", parsed);
  return 1;
}
