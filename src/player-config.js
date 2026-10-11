// Position stays at the standing eye anchor; stance changes preserve the feet.
export const PLAYER_EYE_HEIGHT=2.45;
export const PLAYER_RADIUS=.32;
export const PLAYER_CROUCH_EYE_HEIGHT=1.6;
export const PLAYER_CROUCH_SPEED=.5;
export const playerEyeHeight=crouched=>crouched?PLAYER_CROUCH_EYE_HEIGHT:PLAYER_EYE_HEIGHT;
export const playerHeightOffset=crouched=>PLAYER_EYE_HEIGHT-playerEyeHeight(crouched);
export const playerBodyHeight=(height,crouched)=>height*playerEyeHeight(crouched)/PLAYER_EYE_HEIGHT;
