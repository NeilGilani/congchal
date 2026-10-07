/**
 * Long side of the image the model pipeline decodes. The model's input is
 * 256 px, so 512 px leaves headroom for the half-frame grid windows while
 * keeping pure-JS decoding and cropping fast on the phone.
 */
export const ANALYSIS_LONG_SIDE = 512;
/** Long side of the stored evidence photo (what reports show). */
export const EVIDENCE_LONG_SIDE = 1280;
