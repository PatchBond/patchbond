import { Composition } from "remotion";
import { PatchBond, TOTAL } from "./PatchBond";
import { Short, SHORT_FRAMES } from "./Short";

export function Root() {
  return (
    <>
      <Composition id="PatchBond" component={PatchBond} durationInFrames={TOTAL} fps={30} width={1920} height={1080} defaultProps={{ narrated: false }} />
      <Composition id="PatchBondNarrated" component={PatchBond} durationInFrames={TOTAL} fps={30} width={1920} height={1080} defaultProps={{ narrated: true }} />
      <Composition id="Short" component={Short} durationInFrames={SHORT_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ voice: true }} />
      <Composition id="ShortMusic" component={Short} durationInFrames={SHORT_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ voice: false }} />
    </>
  );
}
