/**
 * 官网中国案例复刻规格（生成文件，勿手改）。
 *
 * 生成器：tools/cn-cases/build-cn-replica-specs.mjs
 * 数据源：assets/site-cases.mjs（4 个「地图试排」案的拟设种子）、
 *         assets/site-activity-cases.mjs 与 assets/site-inspiration-maps.mjs（其余案已描好的轮廓）。
 * 口径：真实地点锚点（WGS-84 → GCJ-02）+ 官网已有内容；只有轮廓的案，场外起手位按最长边派生。
 * 布置一律「拟设」，不是现场实测，也不替主办方补造展位。
 */

import type { ReplicaCaseSpec } from './replica-kit';

export const CN_SPECS: ReplicaCaseSpec[] = [
  {
    "slug": "cn-yuquan-chrysanthemum",
    "title": "杭州植物园菊花展",
    "category": "花卉展",
    "region": "浙江 · 杭州",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://ori.hangzhou.com.cn/ornews/content/2026-11/03/content_9366688.htm",
    "anchor": {
      "lng": 120.120866,
      "lat": 30.254952
    },
    "locationNote": "官网案例 · 杭州网 · 第十二届杭州菊花艺术展；卫星锚点 cite 120.11608,30.25723（WGS-84 → GCJ-02）。区块/物料/流线为官网「拟设 · 拟放」演示，非现场实测，出摊前按当届图纸与现场复尺。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、观众入口、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 120.120866,
      "lat": 30.254952,
      "zoom": 19,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "玉泉主池可辨水面",
          "polygon": [
            [
              2.73,
              14.42
            ],
            [
              26.71,
              9.27
            ],
            [
              23.36,
              -2.32
            ],
            [
              -0.63,
              3.09
            ]
          ]
        }
      ],
      "seeds": [
        {
          "name": "拟设 · 展陈区",
          "kind": "area",
          "points": [
            [
              1.95,
              -0.26
            ],
            [
              18.97,
              -4.12
            ],
            [
              17.94,
              -7.98
            ],
            [
              1.18,
              -4.38
            ]
          ]
        },
        {
          "name": "拟放 · 展台 A",
          "kind": "item",
          "points": [
            [
              8.66,
              -3.86
            ]
          ]
        },
        {
          "name": "拟设 · 换花线",
          "kind": "line",
          "points": [
            [
              -25.13,
              -8.5
            ],
            [
              -13.26,
              -11.07
            ],
            [
              -3.72,
              -13.65
            ],
            [
              2.98,
              -10.82
            ],
            [
              7.11,
              -7.21
            ]
          ]
        },
        {
          "name": "拟放 · 导视牌",
          "kind": "item",
          "points": [
            [
              -4.49,
              -12.36
            ]
          ]
        }
      ]
    },
    "zones": [
      {
        "name": "玉泉主池可辨水面",
        "semantic": "reserved",
        "color": "#5f6b63",
        "opacity": 0.2,
        "polygon": [
          [
            2.73,
            14.42
          ],
          [
            26.71,
            9.27
          ],
          [
            23.36,
            -2.32
          ],
          [
            -0.63,
            3.09
          ]
        ]
      },
      {
        "name": "拟设 · 展陈区",
        "semantic": "reserved",
        "color": "#8d9b62",
        "opacity": 0.3,
        "polygon": [
          [
            1.95,
            -0.26
          ],
          [
            18.97,
            -4.12
          ],
          [
            17.94,
            -7.98
          ],
          [
            1.18,
            -4.38
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            12.88,
            -11.66
          ],
          [
            -0.13,
            -6.48
          ],
          [
            1.53,
            -2.3
          ],
          [
            14.54,
            -7.47
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "booth-2x2",
        "name": "拟放 · 展台 A",
        "size": {
          "width": 3,
          "depth": 1.4
        },
        "placement": {
          "kind": "single",
          "x": 8.66,
          "y": -3.86,
          "rot": 12
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 0.7,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -4.49,
          "y": -12.36,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": 6.93,
          "y": -7.67,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": 14.9,
          "y": -3.85,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": 1.13,
          "y": 10.23,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": 19.02,
          "y": -20.56,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -12.57,
          "y": -7.99,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 换花线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -25.13,
            -8.5
          ],
          [
            -13.26,
            -11.07
          ],
          [
            -3.72,
            -13.65
          ],
          [
            2.98,
            -10.82
          ],
          [
            7.11,
            -7.21
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            26.71,
            9.27
          ],
          [
            10.09,
            -1.68
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "拟设 · 观众入口",
        "kind": "both",
        "x": 7.11,
        "y": -7.21
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": 26.71,
        "y": 9.27
      }
    ]
  },
  {
    "slug": "cn-waic-2026",
    "title": "WAIC 2026 世界人工智能大会",
    "category": "科技大会",
    "region": "上海 · 浦东",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://www.shanghai.gov.cn/nw15343/20260722/4514c99cfd364c3ba7d1b81790a09163.html",
    "anchor": {
      "lng": 121.489959,
      "lat": 31.182512
    },
    "locationNote": "官网案例 · 上海市政府 · WAIC 2026；卫星锚点 cite 121.48548,31.18451（WGS-84 → GCJ-02）。区块/物料/流线为官网「拟设 · 拟放」演示，非现场实测，出摊前按当届图纸与现场复尺。另按入口立面与场地形心补了安检区、安检棚、医疗点、饮水点、导视牌 B、观众入口、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 121.489959,
      "lat": 31.182512,
      "zoom": 18,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "世博展览馆可见屋顶",
          "polygon": [
            [
              -169.55,
              73.75
            ],
            [
              115.52,
              125.26
            ],
            [
              151.79,
              -89.97
            ],
            [
              -130.21,
              -141.99
            ]
          ]
        }
      ],
      "seeds": [
        {
          "name": "拟设 · 等候区",
          "kind": "area",
          "points": [
            [
              -124.08,
              127.3
            ],
            [
              -79.63,
              134.95
            ],
            [
              -77.59,
              123.73
            ],
            [
              -122.04,
              115.57
            ]
          ]
        },
        {
          "name": "拟放 · 导视牌",
          "kind": "item",
          "points": [
            [
              -75.04,
              122.71
            ]
          ]
        },
        {
          "name": "拟设 · 服务区",
          "kind": "area",
          "points": [
            [
              -32.12,
              131.38
            ],
            [
              -9.64,
              134.95
            ],
            [
              -6.58,
              125.77
            ],
            [
              -29.06,
              122.2
            ]
          ]
        },
        {
          "name": "拟设 · 观众动线",
          "kind": "line",
          "points": [
            [
              -133.79,
              105.37
            ],
            [
              -90.87,
              112
            ],
            [
              -61.75,
              117.61
            ],
            [
              -37.74,
              121.69
            ],
            [
              -24.46,
              121.69
            ]
          ]
        },
        {
          "name": "拟放 · 服务台",
          "kind": "item",
          "points": [
            [
              -16.8,
              127.81
            ]
          ]
        }
      ]
    },
    "zones": [
      {
        "name": "世博展览馆可见屋顶",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.2,
        "polygon": [
          [
            -169.55,
            73.75
          ],
          [
            115.52,
            125.26
          ],
          [
            151.79,
            -89.97
          ],
          [
            -130.21,
            -141.99
          ]
        ]
      },
      {
        "name": "拟设 · 等候区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -124.08,
            127.3
          ],
          [
            -79.63,
            134.95
          ],
          [
            -77.59,
            123.73
          ],
          [
            -122.04,
            115.57
          ]
        ]
      },
      {
        "name": "拟设 · 服务区",
        "semantic": "reserved",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -32.12,
            131.38
          ],
          [
            -9.64,
            134.95
          ],
          [
            -6.58,
            125.77
          ],
          [
            -29.06,
            122.2
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -29.6,
            126.85
          ],
          [
            -17.37,
            120.02
          ],
          [
            -19.57,
            116.09
          ],
          [
            -31.79,
            122.92
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 0.7,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -75.04,
          "y": 122.71,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 2,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -16.8,
          "y": 127.81,
          "rot": 345
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -24.22,
          "y": 122.13,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -20.81,
          "y": 103.62,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -34.53,
          "y": 136.48,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -4.84,
          "y": 119.9,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众动线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -133.79,
            105.37
          ],
          [
            -90.87,
            112
          ],
          [
            -61.75,
            117.61
          ],
          [
            -37.74,
            121.69
          ],
          [
            -24.46,
            121.69
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            -130.21,
            -141.99
          ],
          [
            -38.22,
            91.8
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "拟设 · 观众入口",
        "kind": "both",
        "x": -24.46,
        "y": 121.69
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": -130.21,
        "y": -141.99
      }
    ]
  },
  {
    "slug": "cn-keqiao-convention-center",
    "title": "绍兴国际会展中心",
    "category": "场馆空间",
    "region": "浙江 · 绍兴",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://www.cntac.org.cn/zixun/hangye/202611/t20261106_4424820.html",
    "anchor": {
      "lng": 120.52032,
      "lat": 30.101787
    },
    "locationNote": "官网案例 · 中国纺织工业联合会 · 柯桥纺博会；卫星锚点 cite 120.516063,30.104293（WGS-84 → GCJ-02）。区块/物料/流线为官网「拟设 · 拟放」演示，非现场实测，出摊前按当届图纸与现场复尺。本案官网未画流线，图上的「等候到导视」由这两件的位置派生。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、观众入口、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 120.52032,
      "lat": 30.101787,
      "zoom": 17,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "展馆建筑外轮廓",
          "polygon": [
            [
              -174.95,
              135.49
            ],
            [
              -199.34,
              32.03
            ],
            [
              -193.86,
              30.07
            ],
            [
              -199.96,
              3.26
            ],
            [
              -90.23,
              -23.77
            ],
            [
              -108.62,
              -101.65
            ],
            [
              104.23,
              -151.47
            ],
            [
              122,
              -74.83
            ],
            [
              159.61,
              -83.29
            ],
            [
              166.95,
              -55.64
            ],
            [
              174.49,
              -57.29
            ],
            [
              202.8,
              57.2
            ],
            [
              138.94,
              61.12
            ],
            [
              140.91,
              70.92
            ],
            [
              78.4,
              76.08
            ],
            [
              80.36,
              85.77
            ],
            [
              17.02,
              90.42
            ],
            [
              19.5,
              100.22
            ],
            [
              -46,
              105.27
            ],
            [
              -42.28,
              115.58
            ],
            [
              -105.93,
              120.33
            ],
            [
              -104.38,
              129.72
            ],
            [
              -174.95,
              135.49
            ]
          ]
        }
      ],
      "seeds": [
        {
          "name": "拟设 · 等候区",
          "kind": "area",
          "points": [
            [
              -264.74,
              1.4
            ],
            [
              -219.28,
              -8.92
            ],
            [
              -226.51,
              -35.74
            ],
            [
              -270.94,
              -25.42
            ]
          ]
        },
        {
          "name": "拟放 · 导视牌",
          "kind": "item",
          "points": [
            [
              -211.01,
              -25.42
            ]
          ]
        }
      ]
    },
    "zones": [
      {
        "name": "展馆建筑外轮廓",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.2,
        "polygon": [
          [
            -174.95,
            135.49
          ],
          [
            -199.34,
            32.03
          ],
          [
            -193.86,
            30.07
          ],
          [
            -199.96,
            3.26
          ],
          [
            -90.23,
            -23.77
          ],
          [
            -108.62,
            -101.65
          ],
          [
            104.23,
            -151.47
          ],
          [
            122,
            -74.83
          ],
          [
            159.61,
            -83.29
          ],
          [
            166.95,
            -55.64
          ],
          [
            174.49,
            -57.29
          ],
          [
            202.8,
            57.2
          ],
          [
            138.94,
            61.12
          ],
          [
            140.91,
            70.92
          ],
          [
            78.4,
            76.08
          ],
          [
            80.36,
            85.77
          ],
          [
            17.02,
            90.42
          ],
          [
            19.5,
            100.22
          ],
          [
            -46,
            105.27
          ],
          [
            -42.28,
            115.58
          ],
          [
            -105.93,
            120.33
          ],
          [
            -104.38,
            129.72
          ],
          [
            -174.95,
            135.49
          ]
        ]
      },
      {
        "name": "拟设 · 等候区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -264.74,
            1.4
          ],
          [
            -219.28,
            -8.92
          ],
          [
            -226.51,
            -35.74
          ],
          [
            -270.94,
            -25.42
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -210.89,
            -32.7
          ],
          [
            -214.95,
            -19.3
          ],
          [
            -210.65,
            -18
          ],
          [
            -206.59,
            -31.39
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.6
        },
        "placement": {
          "kind": "single",
          "x": -211.01,
          "y": -25.42,
          "rot": 14
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -211.49,
          "y": -25.57,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -203.53,
          "y": -29.42,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -201.09,
          "y": -9.87,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -214.02,
          "y": -43.05,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -223.89,
          "y": -10.51,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 等候到导视（派生）",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -245.37,
            -17.17
          ],
          [
            -211.01,
            -25.42
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            202.8,
            57.2
          ],
          [
            -59.99,
            20.35
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "拟设 · 观众入口",
        "kind": "both",
        "x": -211.01,
        "y": -25.42
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": 202.8,
        "y": 57.2
      }
    ]
  },
  {
    "slug": "cn-yanguan-tide-music",
    "title": "盐官古城 · 潮乐之城",
    "category": "文旅节庆",
    "region": "浙江 · 海宁",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://www.tahemusic.cn/news/2221",
    "anchor": {
      "lng": 120.541099,
      "lat": 30.40995
    },
    "locationNote": "官网案例 · 太合音乐 · 盐官大潮季；卫星锚点 cite 120.53689,30.412482（WGS-84 → GCJ-02）。区块/物料/流线为官网「拟设 · 拟放」演示，非现场实测，出摊前按当届图纸与现场复尺。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、观众入口、后勤补给线、后勤集货区——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 120.541099,
      "lat": 30.40995,
      "zoom": 18,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [],
      "seeds": [
        {
          "name": "拟设 · 签到等候区",
          "kind": "area",
          "points": [
            [
              -0.03,
              -25.14
            ],
            [
              19.51,
              -25.14
            ],
            [
              19.51,
              -35.64
            ],
            [
              -0.03,
              -35.64
            ]
          ]
        },
        {
          "name": "拟设 · 接驳步行引导",
          "kind": "line",
          "points": [
            [
              -3.79,
              24.74
            ],
            [
              -3.04,
              6.74
            ],
            [
              -2.28,
              -14.64
            ],
            [
              -13.93,
              -24.76
            ]
          ]
        },
        {
          "name": "拟放 · 导视牌",
          "kind": "item",
          "points": [
            [
              -13.56,
              -25.89
            ]
          ]
        },
        {
          "name": "待核 · 入口与接驳点",
          "kind": "label",
          "points": [
            [
              22.14,
              -35.64
            ]
          ]
        }
      ]
    },
    "zones": [
      {
        "name": "拟设 · 签到等候区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -0.03,
            -25.14
          ],
          [
            19.51,
            -25.14
          ],
          [
            19.51,
            -35.64
          ],
          [
            -0.03,
            -35.64
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -17.56,
            -31.07
          ],
          [
            -14.18,
            -17.48
          ],
          [
            -9.81,
            -18.57
          ],
          [
            -13.19,
            -32.16
          ]
        ]
      },
      {
        "name": "拟设 · 后勤集货区",
        "semantic": "loading",
        "color": "#8fa3b8",
        "opacity": 0.25,
        "polygon": [
          [
            14.51,
            -39.64
          ],
          [
            24.51,
            -39.64
          ],
          [
            24.51,
            -31.64
          ],
          [
            14.51,
            -31.64
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 0.7,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -13.56,
          "y": -25.89,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -14.42,
          "y": -24.64,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -9.56,
          "y": -32.03,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": 2.55,
          "y": -16.5,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -25.56,
          "y": -38.35,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -17.35,
          "y": -5.36,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 接驳步行引导",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -3.79,
            24.74
          ],
          [
            -3.04,
            6.74
          ],
          [
            -2.28,
            -14.64
          ],
          [
            -13.93,
            -24.76
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            19.51,
            -35.64
          ],
          [
            -1.97,
            -27.6
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 入口与接驳点",
        "kind": "both",
        "x": 22.14,
        "y": -35.64
      },
      {
        "name": "拟设 · 观众入口",
        "kind": "both",
        "x": -13.93,
        "y": -24.76
      }
    ]
  },
  {
    "slug": "cn-canton-fair-139",
    "title": "第139届广交会",
    "category": "产业展会",
    "region": "广东 · 广州",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://cmsfile.cantonfair.org.cn/fileserver/cms/2026-03/202603131141324132894.pdf",
    "anchor": {
      "lng": 113.359629,
      "lat": 23.100351
    },
    "locationNote": "官网案例 · 第139届广交会进口展参展手册；场馆轮廓为官网已描好的底图，锚点取官网 cite 113.35415,23.1029（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 113.359629,
      "lat": 23.100351,
      "zoom": 17,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "广交会展馆地块外轮廓",
          "polygon": [
            [
              -781.12,
              200.68
            ],
            [
              -761.9,
              -75.69
            ],
            [
              -737.73,
              -89.95
            ],
            [
              -218.67,
              -153.01
            ],
            [
              140.01,
              -155.2
            ],
            [
              140.56,
              -363.58
            ],
            [
              140.9,
              -363.58
            ],
            [
              141.11,
              -406.9
            ],
            [
              320.17,
              -415.13
            ],
            [
              320.17,
              -415.01
            ],
            [
              493.19,
              -422.8
            ],
            [
              493.19,
              -363.58
            ],
            [
              493.74,
              -112.43
            ],
            [
              757.4,
              -121.75
            ],
            [
              781.01,
              383.82
            ],
            [
              249.87,
              401.37
            ],
            [
              249.87,
              400.92
            ],
            [
              -403.22,
              422.21
            ],
            [
              -405.97,
              196.29
            ]
          ]
        }
      ],
      "seeds": []
    },
    "zones": [
      {
        "name": "广交会展馆地块外轮廓（官网描图）",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.18,
        "polygon": [
          [
            -781.12,
            200.68
          ],
          [
            -761.9,
            -75.69
          ],
          [
            -737.73,
            -89.95
          ],
          [
            -218.67,
            -153.01
          ],
          [
            140.01,
            -155.2
          ],
          [
            140.56,
            -363.58
          ],
          [
            140.9,
            -363.58
          ],
          [
            141.11,
            -406.9
          ],
          [
            320.17,
            -415.13
          ],
          [
            320.17,
            -415.01
          ],
          [
            493.19,
            -422.8
          ],
          [
            493.19,
            -363.58
          ],
          [
            493.74,
            -112.43
          ],
          [
            757.4,
            -121.75
          ],
          [
            781.01,
            383.82
          ],
          [
            249.87,
            401.37
          ],
          [
            249.87,
            400.92
          ],
          [
            -403.22,
            422.21
          ],
          [
            -405.97,
            196.29
          ]
        ]
      },
      {
        "name": "拟设 · 场外集结区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -52.49,
            416.78
          ],
          [
            -100.47,
            418.34
          ],
          [
            -100.08,
            430.34
          ],
          [
            -52.1,
            428.77
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -69.57,
            414.83
          ],
          [
            -83.56,
            415.29
          ],
          [
            -83.71,
            410.79
          ],
          [
            -69.72,
            410.33
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -76.58,
          "y": 414.56,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -76.61,
          "y": 413.56,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -70.83,
          "y": 406.87,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -89.08,
          "y": 399.46,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -60.38,
          "y": 420.53,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -94.36,
          "y": 421.64,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众入场线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -75.83,
            437.55
          ],
          [
            -76.63,
            413.06
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            493.19,
            -422.8
          ],
          [
            29.66,
            70.08
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 主场入口",
        "kind": "both",
        "x": -76.63,
        "y": 413.06
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": 493.19,
        "y": -422.8
      }
    ]
  },
  {
    "slug": "cn-ciie-9",
    "title": "第九届中国国际进口博览会",
    "category": "产业展会",
    "region": "上海 · 虹桥",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://www.ciie.org/resource/static/zbh/default/assets-2025/download/PDF/CIIE2026ExhibitionServiceFlow%28C%29.pdf",
    "anchor": {
      "lng": 121.301994,
      "lat": 31.189679
    },
    "locationNote": "官网案例 · 进博会 · 展务服务流程；场馆轮廓为官网已描好的底图，锚点取官网 cite 121.29752,31.19168（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。轮廓超过 64 点，已按形状简化到契约上限。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 121.301994,
      "lat": 31.189679,
      "zoom": 17,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "国家会展中心建筑外轮廓",
          "polygon": [
            [
              -465.17,
              32.74
            ],
            [
              -460.57,
              11.83
            ],
            [
              -448.31,
              -13.66
            ],
            [
              -435.54,
              -33.55
            ],
            [
              -424.3,
              -48.34
            ],
            [
              -414.59,
              -58.54
            ],
            [
              -394.16,
              -70.78
            ],
            [
              -361.98,
              -85.06
            ],
            [
              -318.56,
              -96.79
            ],
            [
              -320.09,
              -106.48
            ],
            [
              -242.95,
              -235
            ],
            [
              -233.76,
              -237.55
            ],
            [
              -243.46,
              -282.43
            ],
            [
              -245.51,
              -309.46
            ],
            [
              -245.51,
              -329.86
            ],
            [
              -242.44,
              -349.75
            ],
            [
              -233.25,
              -369.64
            ],
            [
              -207.7,
              -411.46
            ],
            [
              -192.38,
              -424.72
            ],
            [
              -175.52,
              -434.41
            ],
            [
              -154.58,
              -440.02
            ],
            [
              -109.62,
              -444.1
            ],
            [
              -83.57,
              -454.3
            ],
            [
              -66.2,
              -463.48
            ],
            [
              -53.43,
              -467.05
            ],
            [
              -37.59,
              -468.58
            ],
            [
              -18.18,
              -462.97
            ],
            [
              8.89,
              -452.26
            ],
            [
              33.92,
              -436.96
            ],
            [
              49.76,
              -423.19
            ],
            [
              64.57,
              -403.81
            ],
            [
              76.32,
              -383.92
            ],
            [
              91.65,
              -345.67
            ],
            [
              97.78,
              -316.6
            ],
            [
              117.7,
              -295.69
            ],
            [
              146.31,
              -272.23
            ],
            [
              174.92,
              -253.87
            ],
            [
              205.06,
              -241.12
            ],
            [
              230.6,
              -233.98
            ],
            [
              266.36,
              -241.12
            ],
            [
              290.37,
              -244.69
            ],
            [
              330.72,
              -245.71
            ],
            [
              353.71,
              -239.08
            ],
            [
              377.72,
              -227.35
            ],
            [
              401.22,
              -213.07
            ],
            [
              420.12,
              -194.71
            ],
            [
              431.36,
              -179.41
            ],
            [
              437.49,
              -163.6
            ],
            [
              441.57,
              -122.8
            ],
            [
              444.64,
              -107.5
            ],
            [
              450.26,
              -89.14
            ],
            [
              458.94,
              -68.74
            ],
            [
              464.05,
              -53.95
            ],
            [
              466.09,
              -39.16
            ],
            [
              462.52,
              -17.23
            ],
            [
              451.28,
              8.78
            ],
            [
              439.02,
              28.66
            ],
            [
              424.21,
              49.57
            ],
            [
              412.46,
              60.79
            ],
            [
              394.58,
              71.5
            ],
            [
              364.95,
              84.25
            ],
            [
              318.46,
              97.51
            ],
            [
              322.04,
              107.2
            ],
            [
              245.41,
              237.24
            ],
            [
              232.64,
              239.28
            ],
            [
              238.26,
              262.23
            ],
            [
              242.86,
              287.22
            ],
            [
              244.39,
              306.6
            ],
            [
              244.39,
              321.39
            ],
            [
              242.86,
              337.71
            ],
            [
              240.3,
              351.99
            ],
            [
              234.68,
              365.25
            ],
            [
              220.38,
              389.72
            ],
            [
              206.08,
              410.63
            ],
            [
              190.75,
              426.95
            ],
            [
              178.49,
              433.58
            ],
            [
              165.21,
              438.68
            ],
            [
              153.97,
              441.23
            ],
            [
              136.6,
              442.25
            ],
            [
              110.04,
              446.84
            ],
            [
              85.01,
              455
            ],
            [
              64.06,
              464.18
            ],
            [
              50.27,
              467.75
            ],
            [
              32.9,
              467.24
            ],
            [
              10.43,
              462.14
            ],
            [
              -1.84,
              457.04
            ],
            [
              -50.88,
              426.44
            ],
            [
              -65.18,
              408.08
            ],
            [
              -73.86,
              389.72
            ],
            [
              -80.5,
              369.33
            ],
            [
              -89.19,
              347.4
            ],
            [
              -95.32,
              323.94
            ],
            [
              -103.49,
              325.98
            ],
            [
              -235.8,
              245.91
            ],
            [
              -236.31,
              235.2
            ],
            [
              -279.73,
              245.4
            ],
            [
              -300.17,
              246.93
            ],
            [
              -317.53,
              247.44
            ],
            [
              -332.35,
              246.93
            ],
            [
              -344.61,
              244.89
            ],
            [
              -359.42,
              239.28
            ],
            [
              -375.26,
              231.63
            ],
            [
              -392.12,
              220.93
            ],
            [
              -409.49,
              209.2
            ],
            [
              -420.72,
              196.45
            ],
            [
              -429.41,
              185.74
            ],
            [
              -434.52,
              172.99
            ],
            [
              -438.09,
              161.26
            ],
            [
              -443.2,
              118.42
            ],
            [
              -447.29,
              100.57
            ],
            [
              -454.44,
              81.19
            ],
            [
              -462.1,
              63.34
            ],
            [
              -465.17,
              51.1
            ]
          ]
        }
      ],
      "seeds": []
    },
    "zones": [
      {
        "name": "国家会展中心建筑外轮廓（官网描图）",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.18,
        "polygon": [
          [
            -465.17,
            32.74
          ],
          [
            -448.31,
            -13.66
          ],
          [
            -414.59,
            -58.54
          ],
          [
            -361.98,
            -85.06
          ],
          [
            -318.56,
            -96.79
          ],
          [
            -320.09,
            -106.48
          ],
          [
            -242.95,
            -235
          ],
          [
            -233.76,
            -237.55
          ],
          [
            -243.46,
            -282.43
          ],
          [
            -245.51,
            -329.86
          ],
          [
            -233.25,
            -369.64
          ],
          [
            -207.7,
            -411.46
          ],
          [
            -175.52,
            -434.41
          ],
          [
            -109.62,
            -444.1
          ],
          [
            -66.2,
            -463.48
          ],
          [
            -37.59,
            -468.58
          ],
          [
            8.89,
            -452.26
          ],
          [
            49.76,
            -423.19
          ],
          [
            76.32,
            -383.92
          ],
          [
            97.78,
            -316.6
          ],
          [
            146.31,
            -272.23
          ],
          [
            174.92,
            -253.87
          ],
          [
            230.6,
            -233.98
          ],
          [
            290.37,
            -244.69
          ],
          [
            330.72,
            -245.71
          ],
          [
            353.71,
            -239.08
          ],
          [
            401.22,
            -213.07
          ],
          [
            431.36,
            -179.41
          ],
          [
            437.49,
            -163.6
          ],
          [
            444.64,
            -107.5
          ],
          [
            466.09,
            -39.16
          ],
          [
            451.28,
            8.78
          ],
          [
            412.46,
            60.79
          ],
          [
            364.95,
            84.25
          ],
          [
            318.46,
            97.51
          ],
          [
            322.04,
            107.2
          ],
          [
            245.41,
            237.24
          ],
          [
            232.64,
            239.28
          ],
          [
            242.86,
            287.22
          ],
          [
            242.86,
            337.71
          ],
          [
            234.68,
            365.25
          ],
          [
            206.08,
            410.63
          ],
          [
            190.75,
            426.95
          ],
          [
            165.21,
            438.68
          ],
          [
            110.04,
            446.84
          ],
          [
            50.27,
            467.75
          ],
          [
            10.43,
            462.14
          ],
          [
            -50.88,
            426.44
          ],
          [
            -73.86,
            389.72
          ],
          [
            -95.32,
            323.94
          ],
          [
            -103.49,
            325.98
          ],
          [
            -235.8,
            245.91
          ],
          [
            -236.31,
            235.2
          ],
          [
            -279.73,
            245.4
          ],
          [
            -332.35,
            246.93
          ],
          [
            -375.26,
            231.63
          ],
          [
            -409.49,
            209.2
          ],
          [
            -434.52,
            172.99
          ],
          [
            -447.29,
            100.57
          ],
          [
            -465.17,
            51.1
          ]
        ]
      },
      {
        "name": "拟设 · 场外集结区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -152.22,
            303.5
          ],
          [
            -193.28,
            278.65
          ],
          [
            -199.5,
            288.92
          ],
          [
            -158.43,
            313.77
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -165.47,
            292.57
          ],
          [
            -177.44,
            285.32
          ],
          [
            -175.11,
            281.47
          ],
          [
            -163.14,
            288.72
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -171.2,
          "y": 288.51,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -170.68,
          "y": 287.66,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -162.18,
          "y": 285.2,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -173.44,
          "y": 269.04,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -160.87,
          "y": 302.36,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -189.96,
          "y": 284.76,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众入场线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -183.11,
            308.19
          ],
          [
            -170.42,
            287.23
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            -37.59,
            -468.58
          ],
          [
            -19.23,
            32.99
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 主场入口",
        "kind": "both",
        "x": -170.42,
        "y": 287.23
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": -37.59,
        "y": -468.58
      }
    ]
  },
  {
    "slug": "cn-baima-20",
    "title": "第二十届杭州文博会",
    "category": "文化展会",
    "region": "浙江 · 杭州",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://z.hangzhou.com.cn/2026/hzwhcycyblh/index.html",
    "anchor": {
      "lng": 120.20113,
      "lat": 30.162
    },
    "locationNote": "官网案例 · 杭州网 · 第二十届杭州文博会；场馆轮廓为官网已描好的底图，锚点取轮廓形心（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 120.20113,
      "lat": 30.162,
      "zoom": 18,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "白马湖会展中心 A 馆外轮廓",
          "polygon": [
            [
              -58.8,
              2.86
            ],
            [
              -48.48,
              -37.34
            ],
            [
              -30.92,
              -33.22
            ],
            [
              -29.37,
              -39.4
            ],
            [
              135.85,
              3.89
            ],
            [
              122.42,
              58.01
            ],
            [
              -7.17,
              26.06
            ],
            [
              -42.28,
              11.63
            ],
            [
              -41.25,
              7.5
            ]
          ]
        }
      ],
      "seeds": []
    },
    "zones": [
      {
        "name": "白马湖会展中心 A 馆外轮廓（官网描图）",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.18,
        "polygon": [
          [
            -58.8,
            2.86
          ],
          [
            -48.48,
            -37.34
          ],
          [
            -30.92,
            -33.22
          ],
          [
            -29.37,
            -39.4
          ],
          [
            135.85,
            3.89
          ],
          [
            122.42,
            58.01
          ],
          [
            -7.17,
            26.06
          ],
          [
            -42.28,
            11.63
          ],
          [
            -41.25,
            7.5
          ]
        ]
      },
      {
        "name": "拟设 · 场外集结区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            31.54,
            -29.64
          ],
          [
            77.98,
            -17.48
          ],
          [
            81.02,
            -29.08
          ],
          [
            34.59,
            -41.25
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            47.36,
            -22.92
          ],
          [
            60.9,
            -19.37
          ],
          [
            59.76,
            -15.02
          ],
          [
            46.21,
            -18.57
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": 54,
          "y": -20.66,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": 53.75,
          "y": -19.69,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": 46.3,
          "y": -14.93,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": 61.68,
          "y": -2.63,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": 40.17,
          "y": -31,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": 73.06,
          "y": -22.39,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众入场线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            59.83,
            -42.91
          ],
          [
            53.62,
            -19.21
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            -58.8,
            2.86
          ],
          [
            25.84,
            -11.37
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 主场入口",
        "kind": "both",
        "x": 53.62,
        "y": -19.21
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": -58.8,
        "y": 2.86
      }
    ]
  },
  {
    "slug": "cn-aosen-music-festival",
    "title": "2026 奥森计划 · 漾音乐节",
    "category": "音乐节",
    "region": "北京 · 奥森南园",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://banshi.whlyj.beijing.gov.cn/publish/7762441938632923.pdf",
    "anchor": {
      "lng": 116.392292,
      "lat": 40.012366
    },
    "locationNote": "官网案例 · 北京市文旅局 · 营业性演出许可；场馆轮廓为官网已描好的底图，锚点取轮廓形心（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 116.392292,
      "lat": 40.012366,
      "zoom": 18,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "露天剧场草坪轮廓",
          "polygon": [
            [
              -54.55,
              90.75
            ],
            [
              -53.54,
              61.52
            ],
            [
              -65.35,
              60.02
            ],
            [
              -72.89,
              54.17
            ],
            [
              -80.21,
              54.49
            ],
            [
              -85.47,
              57.55
            ],
            [
              -95.49,
              50.56
            ],
            [
              -96.36,
              42.16
            ],
            [
              -101.8,
              37.64
            ],
            [
              -111.5,
              37.32
            ],
            [
              -115.15,
              28.56
            ],
            [
              -107.74,
              22.35
            ],
            [
              -86.89,
              17.51
            ],
            [
              -82.86,
              4.58
            ],
            [
              -86.16,
              -8.38
            ],
            [
              -91,
              -15.37
            ],
            [
              -83.41,
              -26.92
            ],
            [
              -69.32,
              -32.81
            ],
            [
              -61.96,
              -43
            ],
            [
              -61.5,
              -55.46
            ],
            [
              -46.91,
              -63
            ],
            [
              -48.88,
              -69.21
            ],
            [
              -30.54,
              -73.5
            ],
            [
              -24,
              -67.7
            ],
            [
              -8.4,
              -63.13
            ],
            [
              14.15,
              -59.66
            ],
            [
              42.46,
              -59.84
            ],
            [
              66.93,
              -65.46
            ],
            [
              89.11,
              -56.42
            ],
            [
              87.24,
              -51.12
            ],
            [
              100.18,
              -46.33
            ],
            [
              112.35,
              -51.72
            ],
            [
              127.12,
              -40.89
            ],
            [
              119.35,
              -37.42
            ],
            [
              116.74,
              -31.4
            ],
            [
              117.52,
              -22.54
            ],
            [
              110.7,
              -17.65
            ],
            [
              105.12,
              -14.73
            ],
            [
              101.46,
              -7.15
            ],
            [
              95.47,
              -2.9
            ],
            [
              95.75,
              9.2
            ],
            [
              71.69,
              18.88
            ],
            [
              59.89,
              26.27
            ],
            [
              52.16,
              42.67
            ],
            [
              50.51,
              61.61
            ],
            [
              55.95,
              81.89
            ],
            [
              37.7,
              74.81
            ],
            [
              7.7,
              73.4
            ],
            [
              -15.35,
              75.82
            ]
          ]
        }
      ],
      "seeds": []
    },
    "zones": [
      {
        "name": "露天剧场草坪轮廓（官网描图）",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.18,
        "polygon": [
          [
            -54.55,
            90.75
          ],
          [
            -53.54,
            61.52
          ],
          [
            -65.35,
            60.02
          ],
          [
            -72.89,
            54.17
          ],
          [
            -80.21,
            54.49
          ],
          [
            -85.47,
            57.55
          ],
          [
            -95.49,
            50.56
          ],
          [
            -96.36,
            42.16
          ],
          [
            -101.8,
            37.64
          ],
          [
            -111.5,
            37.32
          ],
          [
            -115.15,
            28.56
          ],
          [
            -107.74,
            22.35
          ],
          [
            -86.89,
            17.51
          ],
          [
            -82.86,
            4.58
          ],
          [
            -86.16,
            -8.38
          ],
          [
            -91,
            -15.37
          ],
          [
            -83.41,
            -26.92
          ],
          [
            -69.32,
            -32.81
          ],
          [
            -61.96,
            -43
          ],
          [
            -61.5,
            -55.46
          ],
          [
            -46.91,
            -63
          ],
          [
            -48.88,
            -69.21
          ],
          [
            -30.54,
            -73.5
          ],
          [
            -24,
            -67.7
          ],
          [
            -8.4,
            -63.13
          ],
          [
            14.15,
            -59.66
          ],
          [
            42.46,
            -59.84
          ],
          [
            66.93,
            -65.46
          ],
          [
            89.11,
            -56.42
          ],
          [
            87.24,
            -51.12
          ],
          [
            100.18,
            -46.33
          ],
          [
            112.35,
            -51.72
          ],
          [
            127.12,
            -40.89
          ],
          [
            119.35,
            -37.42
          ],
          [
            116.74,
            -31.4
          ],
          [
            117.52,
            -22.54
          ],
          [
            110.7,
            -17.65
          ],
          [
            105.12,
            -14.73
          ],
          [
            101.46,
            -7.15
          ],
          [
            95.47,
            -2.9
          ],
          [
            95.75,
            9.2
          ],
          [
            71.69,
            18.88
          ],
          [
            59.89,
            26.27
          ],
          [
            52.16,
            42.67
          ],
          [
            50.51,
            61.61
          ],
          [
            55.95,
            81.89
          ],
          [
            37.7,
            74.81
          ],
          [
            7.7,
            73.4
          ],
          [
            -15.35,
            75.82
          ]
        ]
      },
      {
        "name": "拟设 · 场外集结区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -24.97,
            85.91
          ],
          [
            -40.65,
            91.88
          ],
          [
            -36.38,
            103.09
          ],
          [
            -20.7,
            97.12
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -27.17,
            84.07
          ],
          [
            -40.25,
            89.05
          ],
          [
            -41.85,
            84.85
          ],
          [
            -28.77,
            79.86
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -33.88,
          "y": 86.09,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -34.24,
          "y": 85.16,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -30.95,
          "y": 76.95,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -50.62,
          "y": 75.88,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -16.62,
          "y": 86.47,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -48.39,
          "y": 98.57,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众入场线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -25.7,
            107.58
          ],
          [
            -34.42,
            84.69
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            127.12,
            -40.89
          ],
          [
            -4.57,
            12.56
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 主场入口",
        "kind": "both",
        "x": -34.42,
        "y": 84.69
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": 127.12,
        "y": -40.89
      }
    ]
  },
  {
    "slug": "cn-wuzhen-internet-light",
    "title": "2026 乌镇「互联网之光」博览会",
    "category": "科技大会",
    "region": "浙江 · 桐乡乌镇",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://www.zjwx.gov.cn/col/col1677996/art/2026/art_b6cac5708de74cac83c941115ea2f8f1.html",
    "anchor": {
      "lng": 120.487139,
      "lat": 30.755965
    },
    "locationNote": "官网案例 · 乌镇峰会 · 招展公告；场馆轮廓为官网已描好的底图，锚点取轮廓形心（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 120.487139,
      "lat": 30.755965,
      "zoom": 17,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "A / B 馆组团外轮廓",
          "polygon": [
            [
              -91.11,
              -82.02
            ],
            [
              -55.91,
              -88.27
            ],
            [
              -30.45,
              -98.83
            ],
            [
              -5.51,
              -118.7
            ],
            [
              1.46,
              -101.08
            ],
            [
              12.04,
              -85.3
            ],
            [
              17.89,
              -64.61
            ],
            [
              35.33,
              -39.6
            ],
            [
              39.85,
              -16.55
            ],
            [
              52.06,
              2.3
            ],
            [
              59.14,
              23.2
            ],
            [
              71.25,
              43.7
            ],
            [
              75.46,
              62.34
            ],
            [
              86.34,
              79.04
            ],
            [
              59.86,
              86.52
            ],
            [
              29.28,
              100.46
            ],
            [
              1.88,
              116.44
            ],
            [
              -4.69,
              100.87
            ],
            [
              -11.06,
              83.04
            ],
            [
              -18.65,
              66.95
            ],
            [
              -28.3,
              40.21
            ],
            [
              -39.9,
              17.77
            ],
            [
              -49.24,
              -2.41
            ],
            [
              -58.58,
              -21.37
            ],
            [
              -70.17,
              -42.27
            ],
            [
              -78.28,
              -61.84
            ]
          ]
        }
      ],
      "seeds": []
    },
    "zones": [
      {
        "name": "A / B 馆组团外轮廓（官网描图）",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.18,
        "polygon": [
          [
            -91.11,
            -82.02
          ],
          [
            -55.91,
            -88.27
          ],
          [
            -30.45,
            -98.83
          ],
          [
            -5.51,
            -118.7
          ],
          [
            1.46,
            -101.08
          ],
          [
            12.04,
            -85.3
          ],
          [
            17.89,
            -64.61
          ],
          [
            35.33,
            -39.6
          ],
          [
            39.85,
            -16.55
          ],
          [
            52.06,
            2.3
          ],
          [
            59.14,
            23.2
          ],
          [
            71.25,
            43.7
          ],
          [
            75.46,
            62.34
          ],
          [
            86.34,
            79.04
          ],
          [
            59.86,
            86.52
          ],
          [
            29.28,
            100.46
          ],
          [
            1.88,
            116.44
          ],
          [
            -4.69,
            100.87
          ],
          [
            -11.06,
            83.04
          ],
          [
            -18.65,
            66.95
          ],
          [
            -28.3,
            40.21
          ],
          [
            -39.9,
            17.77
          ],
          [
            -49.24,
            -2.41
          ],
          [
            -58.58,
            -21.37
          ],
          [
            -70.17,
            -42.27
          ],
          [
            -78.28,
            -61.84
          ]
        ]
      },
      {
        "name": "拟设 · 场外集结区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -81.6,
            -89.8
          ],
          [
            -67.52,
            -92.3
          ],
          [
            -69.62,
            -104.12
          ],
          [
            -83.7,
            -101.62
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -81.01,
            -87.37
          ],
          [
            -67.23,
            -89.81
          ],
          [
            -66.44,
            -85.38
          ],
          [
            -80.23,
            -82.93
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -74.03,
          "y": -88.1,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -73.86,
          "y": -87.11,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -78.63,
          "y": -79.66,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -59.51,
          "y": -74.93,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -90.92,
          "y": -91.7,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -57.45,
          "y": -97.64,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众入场线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -78.06,
            -110.74
          ],
          [
            -73.77,
            -86.62
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            86.34,
            79.04
          ],
          [
            -17.57,
            -21.57
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 主场入口",
        "kind": "both",
        "x": -73.77,
        "y": -86.62
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": 86.34,
        "y": 79.04
      }
    ]
  },
  {
    "slug": "cn-yiwu-fair-31",
    "title": "第31届义博会 · 出口商品展",
    "category": "产业展会",
    "region": "浙江 · 义乌",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://www.yiwufair.com/Views/ybhh/sys/202503/866227161330696.pdf",
    "anchor": {
      "lng": 120.112921,
      "lat": 29.313166
    },
    "locationNote": "官网案例 · 义博会 · 参展手册；场馆轮廓为官网已描好的底图，锚点取轮廓形心（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 120.112921,
      "lat": 29.313166,
      "zoom": 17,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "义乌国际博览中心外轮廓",
          "polygon": [
            [
              -128.91,
              -134.22
            ],
            [
              -48.21,
              -243.9
            ],
            [
              -44.04,
              -240.79
            ],
            [
              -36.23,
              -250.66
            ],
            [
              -7.07,
              -237.15
            ],
            [
              11.67,
              -218.43
            ],
            [
              16.88,
              -224.67
            ],
            [
              36.67,
              -204.92
            ],
            [
              48.12,
              -192.96
            ],
            [
              71.03,
              -164.89
            ],
            [
              79.88,
              -150.34
            ],
            [
              98.11,
              -116.55
            ],
            [
              106.96,
              -97.31
            ],
            [
              113.73,
              -79.64
            ],
            [
              118.94,
              -59.89
            ],
            [
              125.7,
              -21.42
            ],
            [
              128.31,
              0.41
            ],
            [
              129.35,
              21.72
            ],
            [
              128.31,
              44.08
            ],
            [
              126.23,
              62.79
            ],
            [
              122.58,
              83.58
            ],
            [
              115.81,
              110.09
            ],
            [
              106.44,
              135.56
            ],
            [
              95.5,
              130.36
            ],
            [
              89.26,
              147.52
            ],
            [
              69.99,
              177.15
            ],
            [
              58.02,
              170.39
            ],
            [
              55.41,
              176.63
            ],
            [
              31.46,
              168.31
            ],
            [
              -0.3,
              161.55
            ],
            [
              -16.96,
              158.43
            ],
            [
              -48.73,
              154.8
            ],
            [
              -77.89,
              154.28
            ],
            [
              -106,
              156.88
            ],
            [
              -119.02,
              159.47
            ],
            [
              -128.39,
              111.65
            ],
            [
              -100.28,
              105.93
            ],
            [
              -101.32,
              97.62
            ],
            [
              -65.39,
              90.86
            ],
            [
              -63.83,
              95.54
            ],
            [
              -60.18,
              94.5
            ],
            [
              -54.97,
              90.34
            ],
            [
              -45.6,
              79.42
            ],
            [
              -40.4,
              71.63
            ],
            [
              -36.23,
              61.75
            ],
            [
              -33.11,
              50.83
            ],
            [
              -29.98,
              30.56
            ],
            [
              -29.46,
              17.57
            ],
            [
              -29.98,
              3.53
            ],
            [
              -25.3,
              -7.91
            ],
            [
              -23.73,
              -15.7
            ],
            [
              -24.25,
              -22.98
            ],
            [
              -25.82,
              -30.78
            ],
            [
              -31.02,
              -44.29
            ],
            [
              -35.19,
              -50.53
            ],
            [
              -40.4,
              -55.21
            ],
            [
              -46.12,
              -58.85
            ],
            [
              -53.41,
              -61.45
            ],
            [
              -65.91,
              -81.2
            ],
            [
              -75.8,
              -92.64
            ],
            [
              -86.22,
              -103.03
            ],
            [
              -98.71,
              -113.43
            ]
          ]
        }
      ],
      "seeds": []
    },
    "zones": [
      {
        "name": "义乌国际博览中心外轮廓（官网描图）",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.18,
        "polygon": [
          [
            -128.91,
            -134.22
          ],
          [
            -48.21,
            -243.9
          ],
          [
            -44.04,
            -240.79
          ],
          [
            -36.23,
            -250.66
          ],
          [
            -7.07,
            -237.15
          ],
          [
            11.67,
            -218.43
          ],
          [
            16.88,
            -224.67
          ],
          [
            36.67,
            -204.92
          ],
          [
            48.12,
            -192.96
          ],
          [
            71.03,
            -164.89
          ],
          [
            79.88,
            -150.34
          ],
          [
            98.11,
            -116.55
          ],
          [
            106.96,
            -97.31
          ],
          [
            113.73,
            -79.64
          ],
          [
            118.94,
            -59.89
          ],
          [
            125.7,
            -21.42
          ],
          [
            128.31,
            0.41
          ],
          [
            129.35,
            21.72
          ],
          [
            128.31,
            44.08
          ],
          [
            126.23,
            62.79
          ],
          [
            122.58,
            83.58
          ],
          [
            115.81,
            110.09
          ],
          [
            106.44,
            135.56
          ],
          [
            95.5,
            130.36
          ],
          [
            89.26,
            147.52
          ],
          [
            69.99,
            177.15
          ],
          [
            58.02,
            170.39
          ],
          [
            55.41,
            176.63
          ],
          [
            31.46,
            168.31
          ],
          [
            -0.3,
            161.55
          ],
          [
            -16.96,
            158.43
          ],
          [
            -48.73,
            154.8
          ],
          [
            -77.89,
            154.28
          ],
          [
            -106,
            156.88
          ],
          [
            -119.02,
            159.47
          ],
          [
            -128.39,
            111.65
          ],
          [
            -100.28,
            105.93
          ],
          [
            -101.32,
            97.62
          ],
          [
            -65.39,
            90.86
          ],
          [
            -63.83,
            95.54
          ],
          [
            -60.18,
            94.5
          ],
          [
            -54.97,
            90.34
          ],
          [
            -45.6,
            79.42
          ],
          [
            -40.4,
            71.63
          ],
          [
            -36.23,
            61.75
          ],
          [
            -33.11,
            50.83
          ],
          [
            -29.98,
            30.56
          ],
          [
            -29.46,
            17.57
          ],
          [
            -29.98,
            3.53
          ],
          [
            -25.3,
            -7.91
          ],
          [
            -23.73,
            -15.7
          ],
          [
            -24.25,
            -22.98
          ],
          [
            -25.82,
            -30.78
          ],
          [
            -31.02,
            -44.29
          ],
          [
            -35.19,
            -50.53
          ],
          [
            -40.4,
            -55.21
          ],
          [
            -46.12,
            -58.85
          ],
          [
            -53.41,
            -61.45
          ],
          [
            -65.91,
            -81.2
          ],
          [
            -75.8,
            -92.64
          ],
          [
            -86.22,
            -103.03
          ],
          [
            -98.71,
            -113.43
          ]
        ]
      },
      {
        "name": "拟设 · 场外集结区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -107.62,
            -173.28
          ],
          [
            -79.17,
            -211.95
          ],
          [
            -88.83,
            -219.06
          ],
          [
            -117.28,
            -180.4
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -95.53,
            -185.5
          ],
          [
            -87.23,
            -196.77
          ],
          [
            -83.61,
            -194.11
          ],
          [
            -91.9,
            -182.83
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -90.98,
          "y": -190.84,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -90.17,
          "y": -190.25,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -88.49,
          "y": -181.56,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -71.38,
          "y": -191.32,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -105.7,
          "y": -181.8,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -85.55,
          "y": -209.19,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众入场线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -109.5,
            -204.47
          ],
          [
            -89.77,
            -189.95
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            69.99,
            177.15
          ],
          [
            -10.73,
            -22.06
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 主场入口",
        "kind": "both",
        "x": -89.77,
        "y": -189.95
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": 69.99,
        "y": 177.15
      }
    ]
  },
  {
    "slug": "cn-plastics-expo-27",
    "title": "第二十七届中国塑料博览会",
    "category": "产业展会",
    "region": "浙江 · 余姚",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://cpe.21cp.com/noticeToVisitor/exhibitionMap.html",
    "anchor": {
      "lng": 121.158301,
      "lat": 30.08543
    },
    "locationNote": "官网案例 · 中塑在线 · 展会地图；场馆轮廓为官网已描好的底图，锚点取轮廓形心（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 121.158301,
      "lat": 30.08543,
      "zoom": 17,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "中塑国际会展中心地块轮廓",
          "polygon": [
            [
              -190.75,
              -143.49
            ],
            [
              99.12,
              -155.36
            ],
            [
              85.68,
              -82.62
            ],
            [
              51.07,
              54.07
            ],
            [
              50.03,
              83.27
            ],
            [
              59.13,
              119.38
            ],
            [
              -154.27,
              124.74
            ]
          ]
        }
      ],
      "seeds": []
    },
    "zones": [
      {
        "name": "中塑国际会展中心地块轮廓（官网描图）",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.18,
        "polygon": [
          [
            -190.75,
            -143.49
          ],
          [
            99.12,
            -155.36
          ],
          [
            85.68,
            -82.62
          ],
          [
            51.07,
            54.07
          ],
          [
            50.03,
            83.27
          ],
          [
            59.13,
            119.38
          ],
          [
            -154.27,
            124.74
          ]
        ]
      },
      {
        "name": "拟设 · 场外集结区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -70.04,
            -154.44
          ],
          [
            -22.08,
            -156.4
          ],
          [
            -22.57,
            -168.39
          ],
          [
            -70.53,
            -166.43
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -52.96,
            -152.63
          ],
          [
            -38.97,
            -153.2
          ],
          [
            -38.78,
            -148.71
          ],
          [
            -52.77,
            -148.14
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -45.94,
          "y": -152.42,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -45.9,
          "y": -151.42,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -51.63,
          "y": -144.68,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -33.32,
          "y": -137.42,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -62.19,
          "y": -158.26,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -28.22,
          "y": -159.65,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众入场线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -46.88,
            -175.4
          ],
          [
            -45.88,
            -150.92
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            -154.27,
            124.74
          ],
          [
            -24.58,
            -83.22
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 主场入口",
        "kind": "both",
        "x": -45.88,
        "y": -150.92
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": -154.27,
        "y": 124.74
      }
    ]
  },
  {
    "slug": "cn-taizhou-icec",
    "title": "台州国际博览中心",
    "category": "场馆空间",
    "region": "浙江 · 台州",
    "origin": "cn",
    "refImage": "",
    "refLink": "https://www.tzicec.com/how_to_reach/",
    "anchor": {
      "lng": 121.391448,
      "lat": 28.62154
    },
    "locationNote": "官网案例 · 台州国际博览中心 · 交通与报馆；场馆轮廓为官网已描好的底图，锚点取轮廓形心（WGS-84 → GCJ-02）。场外集结区/导视/入场线按轮廓最长边中点派生，长边不必然是实际门位，属起手位；非现场实测，办证与卸货按当届手册核对。另按入口立面与场地形心补了安检区、安检棚、服务台、医疗点、饮水点、导视牌 B、后勤口、后勤补给线——这些是起手位，不是主办方公布的位置。",
    "confirmedView": {
      "lng": 121.391448,
      "lat": 28.62154,
      "zoom": 17,
      "rotationDeg": 0
    },
    "officialPlan": {
      "caption": "官网案例图（按官网描图数据复现）",
      "areas": [
        {
          "name": "展览建筑外轮廓",
          "polygon": [
            [
              -383.08,
              -81.18
            ],
            [
              -389.48,
              -90.7
            ],
            [
              -389.48,
              -103.37
            ],
            [
              -180.43,
              -294.58
            ],
            [
              -4.41,
              -106.51
            ],
            [
              -95.93,
              -20.69
            ],
            [
              -52.43,
              24.95
            ],
            [
              35.84,
              23.69
            ],
            [
              41.51,
              15.74
            ],
            [
              46.12,
              20.55
            ],
            [
              94.34,
              22.96
            ],
            [
              101.05,
              16.57
            ],
            [
              101.89,
              9.25
            ],
            [
              99.69,
              3.81
            ],
            [
              150.33,
              -38.9
            ],
            [
              147.29,
              -47.27
            ],
            [
              177.27,
              -32.83
            ],
            [
              185.86,
              -35.97
            ],
            [
              184.19,
              -72.7
            ],
            [
              183.98,
              -93.74
            ],
            [
              177.48,
              -96.15
            ],
            [
              174.02,
              -93.84
            ],
            [
              170.14,
              -97.19
            ],
            [
              199.81,
              -123.04
            ],
            [
              249.5,
              -79.82
            ],
            [
              249.08,
              -71.34
            ],
            [
              236.29,
              -37.85
            ],
            [
              227.59,
              -16.6
            ],
            [
              217.74,
              -0.7
            ],
            [
              167.83,
              77.59
            ],
            [
              112.17,
              139.13
            ],
            [
              94.13,
              143.94
            ],
            [
              51.47,
              139.97
            ],
            [
              -35.13,
              142.27
            ],
            [
              -118.05,
              141.33
            ],
            [
              -136.19,
              142.27
            ],
            [
              -146.88,
              141.12
            ],
            [
              -160.09,
              136.72
            ],
            [
              -171.63,
              127.83
            ],
            [
              -200.14,
              100.82
            ],
            [
              -217.65,
              87.95
            ],
            [
              -277.72,
              20.55
            ],
            [
              -276.78,
              12.81
            ],
            [
              -314.83,
              -28.12
            ],
            [
              -326.26,
              -28.74
            ]
          ]
        }
      ],
      "seeds": []
    },
    "zones": [
      {
        "name": "展览建筑外轮廓（官网描图）",
        "semantic": "indoor",
        "color": "#5f6b63",
        "opacity": 0.18,
        "polygon": [
          [
            -383.08,
            -81.18
          ],
          [
            -389.48,
            -90.7
          ],
          [
            -389.48,
            -103.37
          ],
          [
            -180.43,
            -294.58
          ],
          [
            -4.41,
            -106.51
          ],
          [
            -95.93,
            -20.69
          ],
          [
            -52.43,
            24.95
          ],
          [
            35.84,
            23.69
          ],
          [
            41.51,
            15.74
          ],
          [
            46.12,
            20.55
          ],
          [
            94.34,
            22.96
          ],
          [
            101.05,
            16.57
          ],
          [
            101.89,
            9.25
          ],
          [
            99.69,
            3.81
          ],
          [
            150.33,
            -38.9
          ],
          [
            147.29,
            -47.27
          ],
          [
            177.27,
            -32.83
          ],
          [
            185.86,
            -35.97
          ],
          [
            184.19,
            -72.7
          ],
          [
            183.98,
            -93.74
          ],
          [
            177.48,
            -96.15
          ],
          [
            174.02,
            -93.84
          ],
          [
            170.14,
            -97.19
          ],
          [
            199.81,
            -123.04
          ],
          [
            249.5,
            -79.82
          ],
          [
            249.08,
            -71.34
          ],
          [
            236.29,
            -37.85
          ],
          [
            227.59,
            -16.6
          ],
          [
            217.74,
            -0.7
          ],
          [
            167.83,
            77.59
          ],
          [
            112.17,
            139.13
          ],
          [
            94.13,
            143.94
          ],
          [
            51.47,
            139.97
          ],
          [
            -35.13,
            142.27
          ],
          [
            -118.05,
            141.33
          ],
          [
            -136.19,
            142.27
          ],
          [
            -146.88,
            141.12
          ],
          [
            -160.09,
            136.72
          ],
          [
            -171.63,
            127.83
          ],
          [
            -200.14,
            100.82
          ],
          [
            -217.65,
            87.95
          ],
          [
            -277.72,
            20.55
          ],
          [
            -276.78,
            12.81
          ],
          [
            -314.83,
            -28.12
          ],
          [
            -326.26,
            -28.74
          ]
        ]
      },
      {
        "name": "拟设 · 场外集结区",
        "semantic": "queue",
        "color": "#bca783",
        "opacity": 0.3,
        "polygon": [
          [
            -306.71,
            -187.2
          ],
          [
            -271.3,
            -219.6
          ],
          [
            -279.39,
            -228.46
          ],
          [
            -314.81,
            -196.06
          ]
        ]
      },
      {
        "name": "拟设 · 安检区",
        "semantic": "checkin",
        "color": "#bca783",
        "opacity": 0.28,
        "polygon": [
          [
            -292.49,
            -196.83
          ],
          [
            -282.15,
            -206.28
          ],
          [
            -279.12,
            -202.96
          ],
          [
            -289.45,
            -193.51
          ]
        ]
      }
    ],
    "facilities": [
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -286.98,
          "y": -201.19,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:security-checkpoint",
        "name": "拟放 · 安检棚",
        "size": {
          "width": 2,
          "depth": 2
        },
        "placement": {
          "kind": "single",
          "x": -286.31,
          "y": -200.45,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 服务台",
        "size": {
          "width": 1.8,
          "depth": 0.8
        },
        "placement": {
          "kind": "single",
          "x": -286.35,
          "y": -191.6,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:first-aid-point",
        "name": "拟放 · 医疗点",
        "size": {
          "width": 3,
          "depth": 3
        },
        "placement": {
          "kind": "single",
          "x": -267.67,
          "y": -197.85,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:water-refill-point",
        "name": "拟放 · 饮水点",
        "size": {
          "width": 1,
          "depth": 1
        },
        "placement": {
          "kind": "single",
          "x": -303.18,
          "y": -195.18,
          "rot": 0
        }
      },
      {
        "templateId": "oneplan:icon:information-point",
        "name": "拟放 · 导视牌 B",
        "size": {
          "width": 1.2,
          "depth": 0.5
        },
        "placement": {
          "kind": "single",
          "x": -278.09,
          "y": -218.13,
          "rot": 0
        }
      }
    ],
    "routes": [
      {
        "name": "拟设 · 观众入场线",
        "kind": "pedestrian",
        "carrier": "walk",
        "color": "#f2c744",
        "widthM": 3,
        "points": [
          [
            -302.5,
            -218.16
          ],
          [
            -285.97,
            -200.08
          ]
        ]
      },
      {
        "name": "拟设 · 后勤补给线",
        "kind": "service",
        "carrier": "trolley",
        "color": "#8fa3b8",
        "widthM": 4,
        "points": [
          [
            249.08,
            -71.34
          ],
          [
            -43.69,
            -30.77
          ]
        ]
      }
    ],
    "nodes": [
      {
        "name": "待核 · 主场入口",
        "kind": "both",
        "x": -285.97,
        "y": -200.08
      },
      {
        "name": "待核 · 后勤口",
        "kind": "both",
        "x": 249.08,
        "y": -71.34
      }
    ]
  }
];
