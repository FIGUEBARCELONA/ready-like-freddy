import WorkstreamView, { type WorkstreamSection } from "./WorkstreamView";

export default function ControlSection({ section }: { section: WorkstreamSection }) {
  return <WorkstreamView section={section} />;
}
