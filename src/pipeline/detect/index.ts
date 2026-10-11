import type { DetectorKey } from "@/config/detectors";
import { capitalConcentration } from "./capital-concentration";
import { chequeInflation } from "./cheque-inflation";
import { followonCompression } from "./followon-compression";
import { geographicShift } from "./geographic-shift";
import { investorRotation } from "./investor-rotation";
import { outlierDeal } from "./outlier-deal";
import { repeatFounder } from "./repeat-founder";
import { sectorMomentum } from "./sector-momentum";
import { sectorSilence } from "./sector-silence";
import { stageShift } from "./stage-shift";
import { syndicateFormation } from "./syndicate-formation";
import { thesisClustering } from "./thesis-clustering";
import type { Detector } from "./types";

export const DETECTOR_FUNCTIONS: Record<DetectorKey, Detector> = {
  sector_momentum: sectorMomentum,
  stage_shift: stageShift,
  cheque_inflation: chequeInflation,
  investor_rotation: investorRotation,
  thesis_clustering: thesisClustering,
  syndicate_formation: syndicateFormation,
  followon_compression: followonCompression,
  capital_concentration: capitalConcentration,
  geographic_shift: geographicShift,
  sector_silence: sectorSilence,
  outlier_deal: outlierDeal,
  repeat_founder: repeatFounder,
};
