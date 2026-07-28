import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

class WidgetErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, attempt: 0 };
    this.retryButton = React.createRef();
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, details) {
    console.error("Learning Booklet Studio failed to render.", error, details);
  }

  componentDidUpdate(_previousProps, previousState) {
    if (!previousState.failed && this.state.failed) this.retryButton.current?.focus();
  }

  retry = () => {
    this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 }));
  };

  render() {
    if (!this.state.failed) {
      return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    }
    return (
      <main className="app-shell" aria-labelledby="widget-render-error-title">
        <section className="safe-error" role="alert">
          <div>
            <span className="error-code">LBS-RENDER-006</span>
            <h1 id="widget-render-error-title">The workflow view could not render</h1>
            <p>The authoritative run was not changed. Reopen this panel or ask Codex to render the workflow again.</p>
            <button ref={this.retryButton} type="button" onClick={this.retry} autoFocus>Try rendering again</button>
          </div>
        </section>
      </main>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <WidgetErrorBoundary>
      <App />
    </WidgetErrorBoundary>
  </React.StrictMode>,
);
