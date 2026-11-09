import { createRoot } from "react-dom/client";
import { App } from "#ui/App.tsx";
import { startStore } from "#ui/store.ts";

createRoot(document.getElementById("root")!).render(<App />);
void startStore();
