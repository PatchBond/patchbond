import { Composition } from "remotion";
import { PatchBond, TOTAL } from "./PatchBond";

export function Root() {
  return (
    <>
      <Composition id="PatchBond" component={PatchBond} durationInFrames={TOTAL} fps={30} width={1920} height={1080} defaultProps={{ narrated: false }} />
      <Composition id="PatchBondNarrated" component={PatchBond} durationInFrames={TOTAL} fps={30} width={1920} height={1080} defaultProps={{ narrated: true }} />
    </>
  );
}
