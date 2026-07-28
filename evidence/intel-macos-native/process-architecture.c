#include <errno.h>
#include <libproc.h>
#include <mach/machine.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>

static const char *architecture_name(cpu_type_t cpu_type) {
  if (cpu_type == CPU_TYPE_X86_64) return "x86_64";
  if (cpu_type == CPU_TYPE_ARM64) return "arm64";
  return NULL;
}

static void print_json_string(const char *value) {
  putchar('"');
  for (const unsigned char *cursor = (const unsigned char *)value; *cursor; cursor += 1) {
    switch (*cursor) {
      case '\\': fputs("\\\\", stdout); break;
      case '"': fputs("\\\"", stdout); break;
      case '\n': fputs("\\n", stdout); break;
      case '\r': fputs("\\r", stdout); break;
      case '\t': fputs("\\t", stdout); break;
      default:
        if (*cursor < 0x20) printf("\\u%04x", *cursor);
        else putchar(*cursor);
    }
  }
  putchar('"');
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "Usage: process-architecture <pid>\n");
    return 2;
  }

  char *end = NULL;
  errno = 0;
  long parsed_pid = strtol(argv[1], &end, 10);
  if (errno || !end || *end != '\0' || parsed_pid < 1 || parsed_pid > INT32_MAX) {
    fprintf(stderr, "PID must be a positive integer.\n");
    return 2;
  }
  pid_t pid = (pid_t)parsed_pid;

  struct proc_archinfo architecture = {0};
  int result = proc_pidinfo(pid, PROC_PIDARCHINFO, 0, &architecture, sizeof(architecture));
  if (result != (int)sizeof(architecture)) {
    fprintf(stderr, "proc_pidinfo(PROC_PIDARCHINFO) failed for PID %d: %s\n", pid, strerror(errno));
    return 1;
  }

  const char *name = architecture_name(architecture.p_cputype);
  if (!name) {
    fprintf(stderr, "Unsupported process CPU type %d for PID %d.\n", architecture.p_cputype, pid);
    return 1;
  }

  char executable_path[PROC_PIDPATHINFO_MAXSIZE] = {0};
  int path_length = proc_pidpath(pid, executable_path, sizeof(executable_path));
  if (path_length <= 0) {
    fprintf(stderr, "proc_pidpath failed for PID %d: %s\n", pid, strerror(errno));
    return 1;
  }

  fputs("{\"pid\":", stdout);
  printf("%d", pid);
  fputs(",\"architecture\":", stdout);
  print_json_string(name);
  fputs(",\"cpuType\":", stdout);
  printf("%d", architecture.p_cputype);
  fputs(",\"cpuSubtype\":", stdout);
  printf("%d", architecture.p_cpusubtype);
  fputs(",\"executablePath\":", stdout);
  print_json_string(executable_path);
  fputs(",\"method\":\"proc_pidinfo-PROC_PIDARCHINFO\"}\n", stdout);
  return 0;
}
