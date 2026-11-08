import {G402_OFFICIAL} from './g402-official';

/**
 * A deliberately fictional activity assembled from public references.
 * The real venue has NOT hosted or approved this event and has NOT supplied inventory.
 * Official venue diagrams are linked, not copied or used as open-licensed assets.
 */
export const G402_SILVER_SIMULATION = {
  id:'synthetic-g402-silver-v1',
  label:'模拟：银发主题交流讲座',
  activity:{headcount:30,venueIO:'indoor',layout:'two_people_per_desk',checkin:'unknown',stage:'unknown',source:'simulation'},
  venue:{
    name:G402_OFFICIAL.venue,areaM2:G402_OFFICIAL.areaM2,
    officialClassroomReferenceSeats:G402_OFFICIAL.classroomReferenceSeats,
    approvedCapacity:null,confirmedByVenue:false,
    actualWidthM:null,actualDepthM:null,doorPosition:null,doorWidthM:null,doorSwing:null,
    source:G402_OFFICIAL.references.englishLayout,
    // These numbers make an editable test scene, not a reconstruction of G402.
    explorationRectangle:{widthM:14.2,depthM:10,source:'simulation',note:'仅为面积相同的虚构矩形，非场地测量或图纸轮廓。'},
  },
  furniture:{
    desk:{width:1.8,depth:0.6,height:0.7,source:'official_general_reference',sourceUrl:G402_OFFICIAL.references.englishLayout},
    // Visual reference only. Its page does not establish the physical chair width/depth below.
    chair:{width:0.49,depth:0.57,height:0.85,source:'simulation',sourceUrl:null},
    openModelReferences:[
      {name:'School Chair 01',url:'https://polyhaven.com/a/SchoolChair_01',license:'CC0-1.0',use:'reference_only_not_imported'},
      {name:'Furniture Kit',url:'https://kenney.nl/assets/furniture-kit',license:'CC0-1.0',use:'reference_only_not_imported'},
    ],
  },
  // The two scenarios describe synthetic availability, not a warehouse or the venue's assets.
  inventory:{origin:'assumption',deskCount:15,chairCount:30,shortChairCount:25,source:'simulation'},
  mockVenueReview:{status:'unknown',isRealConfirmation:false,note:'模拟场地方尚未核验；此状态不是实际场地方确认。',syntheticDoorWidthM:1.2},
  limits:'不代表真实活动、真实库存、核定容量、消防、无障碍或现场验收。',
} as const;
