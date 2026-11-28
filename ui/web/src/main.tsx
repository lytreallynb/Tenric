import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { getLang } from "@/lib/strings.js";
import App from "./App";

document.documentElement.lang = getLang();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
