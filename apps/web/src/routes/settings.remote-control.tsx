import { createFileRoute } from "@tanstack/react-router";

import { RemoteControlSettingsPanel } from "../components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/remote-control")({
  component: RemoteControlSettingsPanel,
});
