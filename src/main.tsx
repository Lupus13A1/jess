import React from "react";
import ReactDOM from "react-dom/client";
import { Ide } from "@/components/ide/Ide";
import { Toaster } from "@/components/ui/sonner";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Ide />
    <Toaster position="bottom-right" />
  </React.StrictMode>,
);

