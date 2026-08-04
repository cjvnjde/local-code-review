/* ---------- drag intent ---------- */
/** Vertical slack a text drag may wander outside the pressed row before it counts as leaving it. */
export const ROW_SLIP=12;
/** True once the pointer sits far enough past the pressed row that selecting rows is the obvious intent. */
export const leftRow=(y: number,top: number,bottom: number,slip=ROW_SLIP)=>y>bottom+slip||y<top-slip;
