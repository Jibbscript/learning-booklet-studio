import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps/app-with-deps";

function publishHostGlobals(globals) {
  window.openai = { ...(window.openai || {}), ...globals };
  window.dispatchEvent(
    new CustomEvent("learning-booklet:host", { detail: window.openai }),
  );
}

function applyHostContext(context) {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if (context.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
  publishHostGlobals({
    theme: context.theme,
    displayMode: context.displayMode,
    locale: context.locale,
    hostContext: context,
  });
}

export function connectWorkflowHost({ onResult, onContext, onConnection } = {}) {
  const standalone = window.parent === window || new URLSearchParams(location.search).has("standalone");
  if (standalone) {
    return {
      connected: Promise.resolve(false),
      isStandalone: true,
      async reconnect() {
        return false;
      },
      async callTool() {
        return null;
      },
      async sendFollowUp() {
        return false;
      },
      async requestFullscreen() {
        return false;
      },
      async close() {},
    };
  }

  let app = null;
  let connection = null;
  let closed = false;

  function createApp() {
    const next = new App(
      { name: "learning-booklet-studio", version: "0.1.3" },
      { availableDisplayModes: ["inline", "fullscreen"] },
      { autoResize: true },
    );
    next.addEventListener("toolresult", (result) => {
      const payload = result?.structuredContent || result;
      publishHostGlobals({ toolOutput: payload });
      onResult?.(payload);
    });
    next.addEventListener("hostcontextchanged", (context) => {
      applyHostContext(context);
      onContext?.(context);
    });
    return next;
  }

  function establish(reason) {
    if (closed) return Promise.resolve(false);
    app = createApp();
    onConnection?.({ status: "connecting", reason });
    connection = app
      .connect()
      .then(() => {
        applyHostContext(app.getHostContext());
        publishHostGlobals({ toolOutput: window.openai?.toolOutput });
        onConnection?.({ status: "connected", reason });
        return true;
      })
      .catch(() => {
        onConnection?.({ status: "error", reason });
        return false;
      });
    return connection;
  }

  const connected = establish("mount");

  async function requireConnection() {
    const ready = await connection;
    if (!ready || !app) throw new Error("HOST_BRIDGE_UNAVAILABLE");
    return app;
  }

  return {
    connected,
    isStandalone: false,
    async reconnect(reason = "reconnect") {
      if (closed) return false;
      try {
        await app?.close();
      } catch {
        // A failed transport is already unusable; replacement is the recovery path.
      }
      return establish(reason);
    },
    async callTool(name, args) {
      const activeApp = await requireConnection();
      const result = await activeApp.callServerTool({ name, arguments: args });
      if (result?.isError) throw new Error("SERVER_TOOL_REJECTED");
      if (result?.structuredContent) onResult?.(result.structuredContent);
      return result;
    },
    async sendFollowUp(prompt) {
      const activeApp = await requireConnection();
      await activeApp.sendMessage({
        role: "user",
        content: [{ type: "text", text: prompt }],
      });
      return true;
    },
    async requestFullscreen() {
      const activeApp = await requireConnection();
      await activeApp.requestDisplayMode({ mode: "fullscreen" });
      return true;
    },
    async close() {
      closed = true;
      await app?.close();
      app = null;
    },
  };
}
