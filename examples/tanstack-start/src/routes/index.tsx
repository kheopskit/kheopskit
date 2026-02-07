import { createFileRoute } from "@tanstack/react-router";
import { AppContent } from "../content";

export const Route = createFileRoute("/")({
	component: AppContent,
});
