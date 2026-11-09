/**
 * Tokyo International Forum G402: published facts only, no copied plan or guessed geometry.
 * Official material is not presented as open-licensed; retain source links, not the PDF/image.
 */
export const G402_OFFICIAL = {
  venue: 'Tokyo International Forum G402',
  floor: 'G Block 4F',
  areaM2: 142,
  ceilingHeightM: 2.7,
  classroomReferenceSeats: 81,
  classroomSeatsPerTable: 3,
  tableM: { width: 1.8, depth: 0.6, height: 0.7 },
  /** Official language pages give different general chair dimensions; G402 actual chair is unverified. */
  chairM: null,
  chairPublishedAlternatives: {
    japanese: [{width:0.525,depth:0.56,height:0.755}],
    english: [{width:0.55,depth:0.645,height:0.785},{width:0.55,depth:0.575,height:0.8}],
  },
  /** Official diagram labels an emergency exit; its exact geometry and usable status are not established. */
  doors: { emergencyExitIndicated: true, widthM: null, positionM: null, hingeAndSwing: null, currentUsability: null },
  room: { widthM: null, depthM: null, floorPlanCoordinates: null },
  references: {
    japaneseLayout:'https://www.t-i-forum.co.jp/organizer/facilities/conference/layout/',
    englishLayout:'https://www.t-i-forum.co.jp/en/facilities/conference/layout/',
    venueDetails:'https://www.t-i-forum.co.jp/organizer/facilities/conference/',
    classroomPdf:'https://www.t-i-forum.co.jp/en/facilities/conference/layout/G402_layout_classroom81.pdf',
    openFloorPdf:'https://www.t-i-forum.co.jp/en/facilities/conference/layout/G402_layout_openfloor.pdf',
    usageRestrictions:'https://www.t-i-forum.co.jp/general/about/',
  },
  caveat:'官方座席是布置示例，非实测容量、消防核定或现场验收。',
} as const;
