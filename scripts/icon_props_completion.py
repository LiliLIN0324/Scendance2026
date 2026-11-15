"""Original models for the remaining outdoor-planning icons.

Dimensions are in metres. Site buildings and activity zones are generic planning
representations. Aircraft and amusement rides retain their defining silhouette.
"""
import math

import numpy as np

WHITE = "#f7f8ec"
BLUE = "#377baf"
RED = "#c54838"
YELLOW = "#e6b14a"
GREEN = "#5b8159"
METAL = "#a6b0b1"
DARK = "#293843"
WOOD = "#8f6748"
ICE = "#bce1eb"
GROUND = "#788967"
WATER = "#60a5be"


def disk(p, x, y, z, radius, thickness, color, sides=32):
    p.rod((x, y, z), (x, y + thickness, z), radius, color, sides=sides)


def ring(p, x, y, z, radius, thickness, color, sides=32):
    points = [(x + radius * math.cos(a), y, z + radius * math.sin(a))
              for a in np.linspace(0, math.tau, sides + 1)]
    for a, b in zip(points, points[1:]):
        p.rod(a, b, thickness, color, sides=6)


def plate(p, width, depth, color, height=.10):
    p.box((0, height / 2, 0), (width, height, depth), color)


def sign_face(p, text, x, y, z, width, height, color=BLUE, ink=WHITE):
    p.box((x, y, z - .026), (width, height, .05), color)
    p.label([(x-width/2, y-height/2, z), (x+width/2, y-height/2, z),
             (x+width/2, y+height/2, z), (x-width/2, y+height/2, z)],
            text, color, ink)


def signpost(p, text, x=0, z=0, color=BLUE):
    p.box((x, .04, z), (.40, .08, .35), DARK)
    p.rod((x, .06, z), (x, 1.66, z), .03, METAL)
    sign_face(p, text, x, 1.41, z+.047, .92, .53, color)


def rails(p, a, b, height=1.02, color=METAL):
    span = np.asarray(b) - np.asarray(a)
    count = max(1, math.ceil(np.linalg.norm(span) / 1.4))
    for i in range(count + 1):
        x, y, z = np.asarray(a) + span * i / count
        p.rod((x, y, z), (x, y + height, z), .028, color)
    for ratio in (.43, 1):
        rise = (0, height * ratio, 0)
        p.rod(np.asarray(a) + rise, np.asarray(b) + rise, .027, color)


def bench(p, x, z):
    p.box((x, .48, z), (1.6, .10, .48), WOOD)
    p.box((x, .77, z - .19), (1.58, .22, .07), WOOD)
    for d in (-.64, .64):
        for side in (-.16, .16):
            p.rod((x+d, 0, z+side), (x+d, .49 if side > 0 else .85, z+side), .027, METAL)


def table(p, x, z, width=1.65, depth=.70, color=WOOD):
    p.box((x, .77, z), (width, .068, depth), color)
    for dx in (-width*.41, width*.41):
        for dz in (-depth*.39, depth*.39):
            p.rod((x+dx, 0, z+dz), (x+dx, .74, z+dz), .025, METAL)


def gate(p, text, width=4, height=2.85, color=BLUE):
    for x in (-width/2, width/2):
        p.box((x, .08, 0), (.58, .16, .56), DARK)
        p.rod((x, .13, 0), (x, height, 0), .096, METAL)
    p.rod((-width/2, height, 0), (width/2, height, 0), .11, color)
    sign_face(p, text, 0, height, .13, width*.78, .48, color)


def bike_rack(p, x, z, width=2.9):
    p.box((x, .055, z), (width, .11, .56), METAL)
    for dx in np.linspace(-width*.44, width*.44, 6):
        p.rod((x+dx, .08, z-.22), (x+dx, .43, z), .019, BLUE)
        p.rod((x+dx, .43, z), (x+dx, .08, z+.22), .019, BLUE)


def course_crossing(p, second):
    plate(p, 6, 6, ICE)
    p.box((0, .106, 0), (2.0, .014, 5.90), WHITE)
    # A is a perpendicular crossing. B carries the diagonal track.
    direction = np.array([1, 0, .72 if second else 0], dtype=float)
    direction /= np.linalg.norm(direction)
    side = np.array([-direction[2], 0, direction[0]])
    center = np.array([0, .11, 0])
    for offset in (-.66, .66):
        start, end = center + side*offset - direction*2.7, center + side*offset + direction*2.7
        p.rod(start, end, .034, BLUE if second else RED)
    for x, z in ((-2.67, 1.27), (2.66, -1.27)):
        rails(p, (x, .1, z), (x, .1, z + .81), .83, YELLOW)
    signpost(p, "CROSSING B" if second else "CROSSING A", -2.34, -2.40)


def tunnel(p):
    # Segment the barrel vault to keep the passage open through both portals.
    radius = 2.05
    for i in range(16):
        a, b = i * math.pi / 16, (i+1) * math.pi / 16
        section = [(r*math.cos(t), .65+r*math.sin(t), -2.6)
                   for r,t in ((radius,a),(radius,b),(radius+.24,b),(radius+.24,a))]
        p.prism(section, (0, 0, 5.2), METAL if i%2 else "#9a9c92")
    for x in (-2.16, 2.16):
        p.box((x, .325, 0), (.24, .65, 5.2), METAL)
    p.box((0, .037, 0), (4.08, .074, 5.65), DARK)
    for z in (-2.58, 2.58):
        for i in range(12):
            a, b = i*math.pi/12, (i+1)*math.pi/12
            p.rod((2.11*math.cos(a), .65+2.11*math.sin(a), z),
                  (2.11*math.cos(b), .65+2.11*math.sin(b), z), .078, YELLOW)
    sign_face(p, "TUNNEL", 0, 3.02, 2.78, 1.40, .36)


def racer_zone(p, kind):
    width, depth = 7.0, 7.3
    plate(p, width, depth, "#8d9898")
    rail_color = BLUE if kind == "transition" else YELLOW
    for x in (-3.29, 3.29):
        rails(p, (x,.1,-3.36), (x,.1,3.44), .88, rail_color)
    for x in (-2.64, 2.64):
        p.box((x,.108,0), (.075,.011,6.95), WHITE)
    if kind == "transition":
        for z in (-1.96, .43, 2.25):
            bike_rack(p, 0, z, 4.5)
        for x in (-2.23, -1.47, -.72, 0, .72, 1.47, 2.23):
            p.box((x,.11,3.0), (.42,.016,.45), BLUE)
        signpost(p, "BIKE/TRANSITION", 2.80,-2.65)
        return
    if kind == "mixed":
        for i,x in enumerate((-2.00,-.68,.68,2.00)):
            p.box((x,.109,0),(1.16,.012,5.0), [BLUE, RED, YELLOW, GREEN][i])
        signpost(p, "MIXED/RELAY", 2.79,-2.62)
    elif kind == "handover":
        for z in (-1.33, 1.27):
            p.box((0,.11,z),(5.2,.014,.18),YELLOW)
        for x in (-1.8, 0, 1.8):
            p.box((x,.116,0),(.14,.016,2.45),WHITE)
        signpost(p,"RELAY/HANDOVER",2.79,-2.62)
    else:
        for z in (-2.06, .19, 2.36):
            table(p,-1.53,z,2.28)
            for i,color in enumerate((BLUE, RED, YELLOW)):
                p.box((-2.24+i*.63,.93,z),(.43,.25,.37),color)
        signpost(p,"PERSONAL/NEEDS",2.79,-2.62)


def timing_station(p):
    plate(p, 4.4, 3.1, DARK)
    gate(p, "TIMING", 3.68, 2.47)
    for z in (-.36,-.16,.08):
        p.box((0,.124,z),(3.25,.049,.18), BLUE)
    for x in (-1.86,1.86):
        p.box((x,1.04,0),(.18,.25,.20), DARK)
        p.box((x,1.04,.109),(.11,.11,.012), RED)
    p.box((1.85,.38,-.53),(.47,.55,.36),METAL)


def river_crossing(p, rescue=False):
    plate(p, 7.6, 5.6, WATER)
    for z in (-2.21, 2.21):
        p.box((0,.16,z),(7.58,.22,1.1), GROUND)
    if rescue:
        p.box((0,.20,.86),(1.87,.22,2.60), WOOD)
        for z in np.linspace(-.33,2.05,9):
            p.box((0,.324,z),(1.86,.034,.19), "#ad8053")
        rails(p, (-.90,.34,-.38), (-.9,.34,2.17), .95)
        x,z=1.46,1.80
        p.rod((x,.26,z),(x,1.78,z),.038,METAL)
        for i in range(20):
            a,b=i*math.tau/20,(i+1)*math.tau/20
            p.rod((x+.27*math.cos(a),1.28+.27*math.sin(a),z+.072),
                  (x+.27*math.cos(b),1.28+.27*math.sin(b),z+.072),.052,RED if i%5<3 else WHITE,sides=8)
        signpost(p,"SWIM/EVACUATION",2.8,2.0,RED)
    else:
        for z in np.linspace(-2.02,2.02,7):
            p.box((0,.124,z),(2.29,.09,.53), "#b8a880")
            for x in (-1.42,1.42):
                p.rod((x,.11,z),(x,.50,z),.034,YELLOW)
        signpost(p, "FORD", 2.3, 2.28)
    for x in (-2.62,-1.84,1.91,2.74):
        p.box((x,.103,-.76+x*.13),(.61,.012,.034), ICE)


def ice_rink(p, crokicurl=False):
    if crokicurl:
        disk(p,0,0,0,4.40,.10,ICE,8)
        for rad, color in ((2.83,BLUE),(2.07,WHITE),(1.26,RED),(.25,DARK)):
            ring(p,0,.118,0,rad,.028,color)
        rim=[(4.37*math.cos(a),.14,4.37*math.sin(a)) for a in np.linspace(0,math.tau,9)]
        for a,b in zip(rim,rim[1:]):
            p.rod(a,b,.107,WOOD)
        for angle in np.linspace(0,math.tau,8,endpoint=False):
            disk(p,1.10*math.cos(angle),.105,1.10*math.sin(angle),.052,.10,WOOD,10)
        for x,z,color in ((-.87,.33,BLUE),(1.46,.7,RED),(-1.6,-1.25,RED),(2.3,-.2,BLUE)):
            disk(p,x,.102,z,.11,.065,color)
            p.rod((x-.045,.186,z),(x+.045,.186,z),.025,color)
    else:
        width,depth=12,18
        plate(p,width,depth,ICE)
        for x in (-5.87,5.87):
            p.box((x,.46,0),(.20,.76,17.86),WHITE)
            p.box((x,.18,0),(.24,.18,17.89),YELLOW)
        for z in (-8.90,8.90):
            for x in (-3.63,3.63):
                p.box((x,.46,z),(4.43,.76,.20),WHITE)
        for z,color in ((0,RED),(-4.8,BLUE),(4.8,BLUE)):
            p.box((0,.103,z),(11.55,.012,.072), color)
        ring(p,0,.117,0,1.40,.026,BLUE)
        bench(p,0,-8.2)


def cricket_camera(p):
    plate(p,3.3,2.6,"#7b8d5e")
    for x in (-1.20,1.20):
        for z in (-.87,.87):
            p.rod((x,.1,z),(x,1.52,z),.050,METAL)
    p.box((0,1.50,0),(2.55,.16,1.98),WOOD)
    for side in (-1.22,1.22):
        rails(p,(side,1.6,-.88),(side,1.6,.84),.82)
    rails(p,(-1.2,1.60,-.89),(1.2,1.60,-.89),.82)
    camera(p,0,1.60,.35)
    signpost(p,"SLIPS/CAMERA",-1.40,1.09)


def cricket_boundary(p, women):
    # Planning reference only. The placed model represents a boundary station.
    turf = "#839663"
    plate(p,5.05,4.42,turf,.078)
    radius = 3.25 if women else 4.8
    marks = [(radius*math.sin(a),.092,radius*(1-math.cos(a))-.7)
             for a in np.linspace(-.44,.44,17)]
    for a,b in zip(marks,marks[1:]):
        p.rod(a,b,.035,WHITE,sides=8)
    for i in (0,4,8,12,16):
        x,y,z=marks[i]
        disk(p,x,y,z,.072,.13, BLUE if women else RED,10)
    p.rod((0,.1,-1.7),(0,.57,-1.7),.027,METAL)
    for x,z in ((-.21,-1.55),(.22,-1.5),(0,-1.98)):
        p.rod((0,.44,-1.7),(x,.085,z),.026,DARK)
    p.box((0,.62,-1.7),(.26,.14,.20),METAL)
    signpost(p, "WOMEN/BOUNDARY" if women else "MEN/BOUNDARY",1.71,1.39,BLUE if women else DARK)


def tire(p,x,y,z,radius,axis="x"):
    offsets = {"x": (.10,0,0), "z": (0,0,.10)}
    center=np.array((x,y,z))
    offset=np.array(offsets[axis])
    p.rod(center-offset,center+offset,radius,DARK,sides=24)
    p.rod(center-offset*1.04,center+offset*1.04,radius*.50,METAL,sides=16)


def stroller(p,x,z):
    for dx in (-.20,.20):
        for dz in (-.26,.26):
            tire(p,x+dx,.102,z+dz,.099)
        p.rod((x+dx,.16,z+.28),(x+dx,.97,z-.47),.031,METAL)
        p.rod((x+dx,.17,z-.25),(x+dx,.54,z+.09),.024,METAL)
    p.rod((x-.2,.97,z-.47),(x+.2,.97,z-.47),.035,DARK)
    p.box((x,.48,z),(.40,.18,.49),BLUE)
    p.box((x,.59,z-.17),(.41,.25,.09),BLUE)
    for j in range(8):
        a,b=j*math.pi/8,(j+1)*math.pi/8
        cross=[(x-.22,.58+.29*math.sin(a),z+.26*math.cos(a)),
               (x+.22,.58+.29*math.sin(a),z+.26*math.cos(a)),
               (x+.22,.58+.29*math.sin(b),z+.26*math.cos(b)),
               (x-.22,.58+.29*math.sin(b),z+.26*math.cos(b))]
        p.mesh(cross,[(0,1,2),(0,2,3)],BLUE)


def stroller_store(p):
    plate(p,3.9,2.4,"#9ca3a3")
    for x in (-1.81,1.81):
        for z in (-1.02,1.02):
            p.rod((x,.1,z),(x,2.25,z),.044,METAL)
    p.box((0,2.25,0),(3.89,.10,2.34),BLUE)
    rails(p,(-1.80,.1,-1.02),(1.8,.1,-1.02),.72)
    for x in (-1.02,0,1.02):
        stroller(p,x,.24)
    sign_face(p,"STROLLERS",0,2.25,1.19,1.30,.27)

def camera(p,x,y,z,tripod=True):
    if tripod:
        for dx,dz in ((-.30,-.21),(.30,-.21),(0,.36)):
            p.rod((x+dx,y,z+dz),(x,y+.94,z),.025,METAL)
    lift=.94 if tripod else .22
    p.rod((x,y+.09 if tripod else y,z),(x,y+lift+.06,z),.048,DARK)
    p.box((x,y+lift+.17,z),(.31,.26,.44),DARK)
    p.rod((x,y+lift+.15,z+.19),(x,y+lift+.15,z+.42),.105,DARK)
    p.rod((x,y+lift+.15,z+.41),(x,y+lift+.15,z+.431),.078,BLUE)
    p.box((x+.13,y+lift+.33,z-.05),(.24,.14,.054),METAL)


def skycam(p):
    for x in (-3.7,3.7):
        for z in (-2.8,2.8):
            p.box((x,.09,z),(.74,.18,.73),DARK)
            for y1,y2 in ((.18,2.2),(2.2,4.2)):
                p.rod((x,y1,z),(x,y2,z),.058,METAL)
            p.rod((x,4.19,z),(.19 if x>0 else -.19,3.13,.15 if z>0 else -.15),.009,DARK)
    p.box((0,3.10,0),(.57,.19,.43),METAL)
    p.box((0,2.90,0),(.25,.27,.26),DARK)
    p.rod((0,2.89,.11),(0,2.89,.27),.097,DARK)
    p.rod((0,2.89,.26),(0,2.89,.28),.072,BLUE)


def hull(p, length, width, tall, colors):
    sections=[]
    for frac, proportion, raise_y in ((-.50,.78,.06),(-.31,.95,0),(0,1,0),(.32,.82,.05),(.49,.10,.36),(.51,.035,.49)):
        sh=width*proportion*.5
        z=frac*length
        rim=tall+raise_y
        sections.append([(-sh,rim,z),(-sh*.70,.21+raise_y*.37,z),(0,.06+raise_y*.55,z),
                         (sh*.70,.21+raise_y*.37,z),(sh,rim,z)])
    for left,right in zip(sections,sections[1:]):
        for i in range(4):
            p.mesh([left[i],left[i+1],right[i+1],right[i]],[(0,1,2),(0,2,3)],colors[i//2])
        p.mesh([left[0],left[4],right[4],right[0]], [(0,1,2),(0,2,3)], colors[2])
        for i in (0,4):
            p.rod(left[i],right[i],.036,WHITE,sides=8)
    for end in (sections[0], sections[-1]):
        p.mesh(end,[(0,1,2),(0,2,3),(0,3,4)],colors[0])


def boat(p,kind):
    if kind=="rescue":
        hull(p,3.85,.74,.24,(YELLOW,YELLOW,GOLD_ORANGE))
        p.box((0,.258,-.24),(.37,.037,.68),DARK)
        p.box((0,.36,-.54),(.32,.26,.077),DARK)
        p.rod((-.54,.335,-.78),(.55,.39,.83),.025,METAL)
        for dx,dz in ((-.53,-.77),(.54,.82)):
            p.box((dx,.36,dz),(.19,.036,.31),RED)
        sign_face(p,"RESCUE",0,.32,.66,.51,.12,RED)
        return
    long=6.9 if kind=="tv" else 4.9
    width=2.35 if kind=="tv" else 1.75
    hull(p,long,width,.59,(BLUE,BLUE,"#d5bf98"))
    p.box((0,.65,-long*.35),(width*.59,.15,.50),WOOD)
    p.box((0,.82,-long*.43),(.42,.65,.41),DARK)
    if kind=="tv":
        p.box((0,1.02,.87),(width*.72,.85,1.49),WHITE)
        p.box((0,1.35,1.625),(width*.63,.35,.032),DARK)
        p.box((0,1.48,.85),(width*.77,.12,1.57),WHITE)
        pole=(.60,1.52,1.01)
        p.rod(pole,(pole[0],2.19,pole[2]),.030,METAL)
        p.rod((.60,2.12,1.01),(.60,2.22,1.24),.21,WHITE)
        sign_face(p,"TV",0,1.05,1.64,.59,.27)
        camera(p,0,.63,-1.75)
        camera(p,-.31,1.56,.48,False)
    else:
        p.box((.34,.83,-.98),(.57,.41,.47),WHITE)
        p.box((.34,.99,-.73),(.45,.17,.038),DARK)
        p.box((0,.67,.93),(1.11,.11,.83),METAL)
        camera(p,0,.72,.95)
    for x in (-width*.39,width*.39):
        rails(p,(x,.60,-long*.30),(x,.60,long*.23),.39)


GOLD_ORANGE="#e88f37"


def rescue_motorcycle(p):
    for z in (-.78,.76):
        tire(p,0,.36,z,.353)
    p.rod((0,.64,-.24),(0,.36,-.78),.09,METAL)
    p.rod((0,1.09,.48),(0,.36,.76),.069,METAL)
    p.rod((-.35,1.10,.43),(.35,1.10,.43),.032,METAL)
    p.sphere((0,.79,.16),(.34,.28,.47),WHITE)
    p.box((0,.77,-.32),(.40,.12,.66),DARK)
    p.box((0,.52,.03),(.39,.37,.41),METAL)
    p.box((0,1.16,.51),(.45,.39,.07),BLUE)
    p.box((0,.91,.64),(.23,.18,.066),WHITE)
    for x in (-.31,.31):
        p.box((x,.77,-.59),(.28,.33,.47),WHITE)
        p.box((x,.77,-.828),(.18,.047,.012),RED)
        p.box((x,.77,-.833),(.047,.18,.012),RED)
    p.box((0,1.04,-.64),(.25,.09,.16),BLUE)


def coach(p):
    width, depth=2.55,12.1
    p.box((0,.79,0),(width,.58,depth),DARK)
    p.box((0,1.73,0),(width,1.85,depth),WHITE)
    p.box((0,2.89,-.06),(width*.99,.54,depth*.99),WHITE)
    p.box((0,3.18,-.15),(2.11,.13,3.13),METAL)
    for x in (-1.24,1.24):
        for z in (-4.35,-3.02,4.18):
            tire(p,x,.51,z,.495)
        p.box((x*1.032,1.48,-1.92),(.02,.22,7.28),BLUE)
        for i in range(7):
            p.box((x*1.033,2.44,-4.81+i*1.40),(.048,.87,1.21),"#526e7b")
    p.box((0,2.36,6.063),(2.34,1.22,.05),"#354f60")
    p.box((.967,1.74,4.75),(.065,1.95,.81),DARK)
    p.box((1.01,2.07,4.75),(.049,1.18,.64),"#526e7b")
    for x in (-.95,.95):
        p.box((x,1.08,6.07),(.37,.15,.065),YELLOW)
        p.box((x,1.27,-6.07),(.18,.40,.06),RED)
    sign_face(p,"COACH",0,3.07,6.095,1.38,.22,DARK)


def spitfire(p):
    # Mk I family silhouette. The outline is original geometry with an 11.23 m elliptical span.
    # Reference: Science Museum Group, Supermarine Spitfire Mk 1A.
    olive="#657957"
    pale="#a1aead"
    stations=[(-4.85,1.05,.13,.16),(-4.12,1.10,.30,.31),(-2.60,1.19,.47,.46),
              (-.65,1.33,.58,.66),(1.39,1.36,.58,.61),(3.16,1.38,.46,.51),(3.80,1.38,.32,.37)]
    rings=[]
    for z,y,rx,ry in stations:
        rings.append([(rx*math.cos(t),y+ry*math.sin(t),z)
                      for t in np.linspace(0,math.tau,24,endpoint=False)])
    for close in (rings[0],rings[-1]):
        p.prism(close,(0,0,.008),olive)
    for a,b in zip(rings,rings[1:]):
        for i in range(24):
            k=(i+1)%24
            p.mesh([a[i],a[k],b[k],b[i]],[(0,1,2),(0,2,3)],olive if i<12 else pale)
    for side in (-1,1):
        wing=[(side*x,y,z) for x,y,z in
              [(0,1.14,1.42),(1.05,1.16,1.37),(2.37,1.22,1.14),(3.69,1.31,.82),
               (4.76,1.405,.39),(5.38,1.52,-.06),(5.615,1.56,-.49),(5.46,1.52,-.84),
               (4.84,1.42,-1.14),(3.67,1.30,-1.40),(2.30,1.22,-1.54),(.58,1.145,-1.56)]]
        center=(side*2.35,1.42,-.25)
        end=len(wing)
        p.mesh([*wing,center],[(end,i,(i+1)%end) for i in range(end)], olive)
        p.mesh([*wing,(side*2.35,1.14,-.25)],[(end,(i+1)%end,i) for i in range(end)], pale)
        x=side*3.19
        for radius,y,color in ((.45,1.404,"#354b67"),(.30,1.408,WHITE),(.15,1.411,RED)):
            p.rod((x,y,-.16),(x,y+.002,-.16),radius,color)
        tail=[(0,1.09,-3.45),(side*1.46,1.18,-3.85),(side*1.56,1.19,-4.22),
              (side*.88,1.14,-4.55),(0,1.08,-4.67)]
        p.prism(tail,(0,.080,0),olive)
        p.rod((side*1.53,1.13,.41),(side*1.65,.44,.53),.067,METAL)
        tire(p,side*1.66,.43,.53,.413)
    p.prism([(-.065,1.12,-4.78),(-.065,1.52,-3.80),(-.065,2.45,-4.42),
             (-.065,2.31,-4.83),(-.065,1.20,-5.08)],(.13,0,0),olive)
    p.sphere((0,1.89,-.59),(.42,.43,.88),"#476775")
    for z in (-1.16,-.45,.12):
        p.rod((-.37,1.91,z),(0,2.29,z),.022,METAL)
        p.rod((0,2.29,z),(.37,1.91,z),.022,METAL)
    p.rod((0,1.38,3.74),(0,1.38,4.40),.31,olive,tip=.014)
    for a in np.linspace(0,math.tau,3,endpoint=False):
        x,y=math.cos(a),math.sin(a)
        p.rod((.16*x,1.38+.16*y,3.97),(1.35*x,1.38+1.35*y,4.04),.075,DARK,tip=.05)
    tire(p,0,.19,-4.38,.172)


def person(p,x,y,z,role,scale=1):
    def at(a,b,c):
        return (x+a*scale,y+b*scale,z+c*scale)
    def ball(ctr, dims, color):
        p.sphere(at(*ctr),tuple(v*scale for v in dims),color)
    def limb(a,b,r,c):
        p.rod(at(*a),at(*b),r*scale,c)
    clothes = {"elf": GREEN, "clown":YELLOW, "medic":RED, "santa":RED,
               "mary":"#5e84a4","joseph":"#a3835c","rider":"#2e526d"}
    color=clothes[role]
    ball((0,1.04,0),(.26,.42,.20), color)
    ball((0,1.58,.02),(.18,.21,.17),"#e1b795")
    for dx in (-.13,.13):
        limb((dx,.83,0),(dx*1.53,.35,.025),.096,color)
        limb((dx*1.53,.35,.025),(dx*1.65,.12,.035),.083,DARK)
        ball((dx*1.65,.095,.11),(.11,.093,.17),DARK)
        limb((dx*1.72,1.24,0),(dx*2.78,.98,.17),.071,color)
        ball((dx*2.80,.974,.188),(.064,.073,.067),"#e1b795")
    for dx in (-.066,.066):
        ball((dx,1.617,.162),(.019,.023,.019),DARK)
    if role in ("elf","santa"):
        limb((0,1.73,.02),(.11,2.02,-.04),.175,RED if role=="santa" else GREEN)
        ball((.11,2.04,-.04),(.07,.066,.068),WHITE)
        limb((0,1.74,.02),(0,1.79,.02),.184,WHITE if role=="santa" else RED)
        if role=="elf":
            for dx in (-.18,.18):
                ball((dx,1.60,0),(.068,.041,.048),"#e1b795")
    if role=="clown":
        ball((0,1.54,.192),(.056,.051,.049),RED)
        for dx in (-.175,.175):
            ball((dx,1.69,-.008),(.108,.105,.113),RED)
        ball((0,1.30,.213),(.110,.047,.035),RED)
    if role=="medic":
        ball((0,1.73,.006),(.19,.124,.174),WHITE)
        p.box(at(0,.994,.204),(.24*scale,.061*scale,.021*scale),WHITE)
        p.box(at(0,.994,.207),(.061*scale,.24*scale,.021*scale),WHITE)
        p.box(at(0,1.06,-.211),(.35*scale,.42*scale,.18*scale),DARK)
    if role=="rider":
        ball((0,1.72,.014),(.18,.115,.18),DARK)
    if role in ("mary","joseph"):
        ball((0,1.68,-.049),(.20,.235,.171),color)


def ski_medic(p):
    for x in (-.26,.26):
        p.box((x,.032,.17),(.105,.058,1.97),DARK)
        p.rod((x,.033,1.11),(x,.122,1.18),.052,DARK)
        p.rod((x*1.53,.034,-.25),(x*1.45,1.0,.10),.018,METAL)
    person(p,0,.05,0,"medic")

def glazed_block(p,x,z,width,depth,height,accent):
    p.box((x,height*.5,z),(width,height,depth),"#d9dfda")
    p.box((x,height+.05,z),(width+.16,.13,depth+.16),accent)
    for zside in (-1,1):
        edge=z+zside*(depth/2+.022)
        for dx in np.linspace(-width*.40,width*.40,max(3,int(width/1.45))):
            for y in np.linspace(max(.92,height*.43),height*.78,2):
                p.box((x+dx,y,edge),(.73,.54,.055),"#456173")
    p.box((x,.84,z+depth/2+.02),(1.40,1.68,.05),"#486774")


def transport(p,kind):
    if kind=="airport":
        plate(p,22,15,"#a2a9a9")
        glazed_block(p,-4,-3.7,12.13,4.65,3.55,BLUE)
        p.box((-3.97,1.9,-1.35),(9.49,1.93,.093),"#557488")
        for x in np.linspace(-8.2,.1,8):
            p.box((x,1.89,-1.28),(.105,1.95,.14),METAL)
        p.box((-4.06,2.83,-.86),(9.78,.15,1.65),METAL)
        sign_face(p,"AIRPORT/TERMINAL",-4.16,3.27,-1.28,3.21,.42,BLUE)
        p.box((6.21,2.61,-3.41),(1.34,5.03,1.32),WHITE)
        p.box((6.21,5.46,-3.41),(2.23,.77,2.21),"#526777")
        p.box((6.21,5.92,-3.41),(2.40,.16,2.39),BLUE)
        p.rod((6.21,5.98,-3.41),(6.21,6.81,-3.41),.048,METAL)
        p.box((0,.108,4.54),(21.75,.017,3.22),DARK)
        for x in np.linspace(-9,9,8):
            p.box((x,.121,4.54),(1.22,.015,.098),WHITE)
        return
    if kind=="station":
        plate(p,15.0,9.2,"#9fa999")
        glazed_block(p,0,-2.62,8.9,3.22,2.8,WOOD)
        for zside in (-1,1):
            p.prism([(-4.67,2.83,-2.62),(4.67,2.83,-2.62),(4.67,3.92,-2.62),(-4.67,3.92,-2.62)],
                    (0,0,zside*.016),BLUE)
            p.mesh([(-4.75,3.85,-2.62),(4.75,3.85,-2.62),(4.75,2.85,-2.62+zside*1.84),(-4.75,2.85,-2.62+zside*1.84)],
                   [(0,1,2),(0,2,3)],DARK)
        p.box((0,.263,-.09),(14.8,.29,1.94),METAL)
        p.box((0,.418,.81),(14.8,.021,.13),YELLOW)
        for z in (1.97,3.40):
            p.box((0,.173,z),(14.9,.12,.095),METAL)
        for x in np.linspace(-7.11,7.11,25):
            p.box((x,.135,2.68),(.23,.072,2.05),WOOD)
        sign_face(p,"RAIL/STATION",0,2.64,-.97,1.76,.35)
        return
    plate(p,13.8,7.8,"#969f9f")
    for z in (-3,0,3):
        for x in (-5.82,5.82):
            p.rod((x,.1,z),(x,2.76,z),.059,METAL)
    p.box((0,2.82,-1.76),(12.12,.16,2.75),BLUE)
    for x in (-4.38,-1.45,1.48,4.41):
        p.box((x,.16,-1.50),(2.78,.12,2.63),METAL)
        bench(p,x,-1.54)
        p.box((x-1.26,.108,2.01),(.075,.014,3.62),YELLOW)
    sign_face(p,"BUS & COACH/STATION",0,2.68,-.34,3.25,.48,BLUE)


def hospital(p):
    plate(p,12,9,"#a3aaa7")
    glazed_block(p,0,-1.3,10.35,5.86,4.92,BLUE)
    p.box((0,1.47,1.84),(4.45,2.77,.76),"#c0ccd0")
    p.box((0,2.9,2.30),(4.84,.18,2.52),BLUE)
    p.box((0,1.19,2.25),(2.43,2.16,.05),"#557789")
    for x in (-2.12,2.12):
        p.rod((x,.1,3.26),(x,2.84,3.26),.067,METAL)
    p.box((0,4.27,1.66),(.37,1.10,.055),RED)
    p.box((0,4.27,1.69),(1.10,.37,.044),RED)
    sign_face(p,"HOSPITAL",0,3.48,1.69,2.24,.43)


def cabin_room(p, accessible):
    width,depth=(4.55,3.65) if accessible else (5.35,3.9)
    plate(p,width,depth,WHITE,.14)
    p.box((0,1.34,-depth*.48),(width,2.55,.15), BLUE if accessible else "#bba586")
    for x in (-width*.486,width*.486):
        p.box((x,1.34,0),(.15,2.55,depth),BLUE if accessible else "#bba586")
    p.box((0,2.57,depth*.47),(width,.23,.15),BLUE if accessible else "#bba586")
    if accessible:
        # Height-adjustable adult bench, overhead hoist rail, WC and grab rails.
        p.box((-1.51,.79,-.18),(.91,.14,1.82),BLUE)
        for z in (-.81,.46):
            p.rod((-1.51,.16,z),(-1.51,.75,z),.096,METAL)
        p.rod((-1.56,2.43,-1.43),(.66,2.43,-1.43),.037,METAL)
        p.rod((-.42,2.37,-1.40),(-.42,1.78,-1.40),.027,DARK)
        for x in (.65,1.59):
            p.rod((x,.88,-1.77),(x,.88,-.78),.035,METAL)
        p.box((1.12,.72,-1.42),(.51,.63,.30),WHITE)
        p.sphere((1.12,.515,-1.15),(.29,.12,.38),METAL)
        p.sphere((1.12,.50,-1.14),(.23,.07,.30),DARK)
        sign_face(p,"CHANGING/PLACES",0,2.57,depth*.48+.08,2.1,.37)
    else:
        for i,(x,z) in enumerate(((-1.45,-.98),(0,-.98),(1.45,-.98),(-1.45,.04),(0,.04),(1.45,.04))):
            p.box((x,.168,z),(.64,.043,.81),["#577c80","#af996b","#8c9b80"][i%3])
        bench(p,0,-1.56)
        sign_face(p,"QUIET/ROOM",0,2.56,depth*.48+.08,1.55,.37,GREEN)


def rest_area(p):
    plate(p,6.3,4.65,GROUND)
    for x in (-2.8,2.8):
        for z in (-1.94,1.96):
            p.rod((x,.1,z),(x,2.64,z),.064,WOOD)
    for z in np.linspace(-1.92,1.95,10):
        p.box((0,2.65,z),(5.85,.11,.14),WOOD)
    for x in (-2.68,0,2.68):
        p.box((x,2.56,0),(.13,.17,4.06),WOOD)
    for x in (-1.48,1.48):
        bench(p,x,-.91)
        table(p,x,.52,.87,.60)


def lookout(p):
    for x in (-1.44,1.44):
        for z in (-1.44,1.44):
            p.rod((x,0,z),(x*.65,5.12,z*.65),.076,WOOD)
    for s in (-1,1):
        p.rod((-1.35,1.20,1.35*s),(1.05,4.42,1.05*s),.053,WOOD)
        p.rod((1.35,1.20,1.35*s),(-1.05,4.42,1.05*s),.053,WOOD)
        p.rod((1.35*s,1.20,-1.35),(1.05*s,4.42,1.05),.053,WOOD)
    p.box((0,5.1,0),(2.63,.16,2.63),WOOD)
    # Cabin surfaces and viewing windows.
    for x in (-1.03,1.03):
        p.box((x,5.64,0),(.12,.99,2.12),WOOD)
        p.box((x,6.29,0),(.10,.63,2.12),"#5c7985")
    for z in (-1.05,1.05):
        p.box((0,5.64,z),(2.12,.99,.11),WOOD)
        p.box((0,6.29,z),(2.12,.62,.10),"#5c7985")
    p.box((0,6.66,0),(2.73,.19,2.73),RED)
    for x in (-.27,.27):
        p.rod((x,.1,1.74),(x,5.27,1.35),.035,METAL)
    for y in np.linspace(.22,4.92,16):
        z=1.74-(y/5.3)*.39
        p.rod((-.27,y,z),(.27,y,z),.022,METAL)


def network(p, kind):
    if kind == "firewall":
        for x in (-.40,.40):
            p.box((x,.71,0),(.71,1.42,.58),DARK)
            for y in np.linspace(.26,1.27,7):
                p.box((x,y,.296),(.63,.103,.049),METAL)
                for dx in (-.22,-.16,.11,.18,.23):
                    p.box((x+dx,y,.326),(.031,.030,.016), GREEN if dx<0 else DARK)
        sign_face(p,"NETWORK/FIREWALL",0,1.48,.34,1.32,.26,BLUE)
    elif kind == "generator":
        plate(p,3.55,2.47,DARK)
        p.box((0,.79,0),(2.04,1.38,1.14),YELLOW)
        p.box((0,.39,.595),(1.65,.36,.07),DARK)
        p.box((.64,.97,.593),(.44,.40,.077),METAL)
        p.rod((-.63,1.37,-.31),(-.63,1.67,-.31),.08,DARK)
        for x in np.linspace(-.76,.15,6):
            p.box((x,1.009,.595),(.041,.26,.027),DARK)
        rails(p,(-1.55,.1,-.96),(-1.55,.1,.96),.62,YELLOW)
        rails(p,(1.55,.1,-.96),(1.55,.1,.96),.62,YELLOW)
    else:
        plate(p,1.50,1.15,METAL)
        p.box((0,.72,0),(.77,1.24,.44),GREEN)
        p.box((0,1.35,0),(.85,.11,.51),METAL)
        for x in (-.21,.21):
            for y in (.58,.96):
                p.rod((x,y,.218),(x,y,.279),.093,DARK)
                p.rod((x,y,.276),(x,y,.296),.054,RED)
        sign_face(p,"MAINS",0,1.42,.264,.69,.23,GREEN)


def risk_pin(p):
    disk(p,0,0,0,.26,.046,DARK)
    p.rod((0,.047,0),(0,.83,0),.035,METAL)
    p.prism([(-.32,.82,0),(.32,.82,0),(0,1.45,0)],(0,0,.055),YELLOW)
    p.box((0,1.05,.059),(.053,.19,.014),DARK)
    p.box((0,.908,.06),(.055,.058,.014),DARK)

def fruit_bowl(p):
    for lo,hi,r1,r2 in ((0,.028,.10,.115),(.028,.073,.115,.18),(.073,.125,.18,.214)):
        p.rod((0,lo,0),(0,hi,0),r1,WOOD,tip=r2,sides=24)
    disk(p,0,.122,0,.212,.013,YELLOW)
    colors=("#d28530","#be5746","#a36e40","#d3ab55")
    for i in range(13):
        a=i*math.tau/13
        x,z=.139*math.cos(a),.139*math.sin(a)
        p.sphere((x,.147,z),(.052,.034,.039),colors[i%4])
    for i,x in enumerate((-.09,-.043,.012,.08)):
        p.sphere((x,.164,.018),(.052,.050,.047),colors[(i+1)%4])


def santa(p):
    disk(p,0,0,0,.72,.07,DARK)
    p.sphere((0,1.18,0),(.72,.90,.56),RED)
    p.sphere((0,2.02,.10),(.48,.47,.42),"#e0b394")
    p.sphere((0,1.81,.34),(.48,.39,.31),WHITE)
    for x in (-.49,.49):
        p.sphere((x*1.39,1.37,0),(.27,.47,.28),RED)
        p.sphere((x*1.55,1.15,.04),(.20,.235,.20),DARK)
        p.sphere((x*.75,.36,.12),(.28,.26,.36),DARK)
        p.sphere((x*.39,2.15,.47),(.055,.069,.045),DARK)
    p.rod((0,2.20,.05),(.065,2.73,-.12),.47,RED,tip=.11)
    p.rod((0,2.22,.05),(0,2.35,.05),.485,WHITE)
    p.sphere((.065,2.71,-.12),(.13,.13,.13),WHITE)
    p.rod((0,.94,0),(0,1.15,0),.697,DARK,sides=24)
    p.box((0,1.04,.573),(.22,.20,.048),YELLOW)
    p.box((0,1.03,.603),(.13,.10,.023),DARK)
    p.rod((0,.092,0),(.81,.06,-.355),.091,RED)


def nativity(p):
    plate(p,4.46,3.23,WOOD)
    for x in (-1.94,1.94):
        for z in (-1.31,1.31):
            p.rod((x,.1,z),(x,2.26,z),.072,WOOD)
    p.box((0,1.18,-1.34),(4.15,2.17,.13),"#a3835c")
    for end in (-1,1):
        p.mesh([(-2.14,3.03,-.06),(2.14,3.03,-.06),(2.14,2.26,end*1.60),(-2.14,2.26,end*1.60)],
               [(0,1,2),(0,2,3)],"#af9060")
    for x in (-.31,.31):
        p.rod((x,.10,.10),(x,.62,.53),.028,WOOD)
        p.rod((x,.1,.53),(x,.62,.10),.028,WOOD)
    p.prism([(-.54,.50,.03),(.54,.50,.03),(.48,.67,.32),(-.48,.67,.32)],(0,0,.43),WOOD)
    p.sphere((.09,.70,.40),(.27,.11,.16),WHITE)
    p.sphere((-.14,.75,.40),(.077,.076,.084),"#dfab89")
    person(p,-1.00,.10,.38,"mary",.72)
    person(p,1.06,.10,.28,"joseph",.82)


def reindeer(p):
    p.box((0,.78,-.18),(.55,.44,1.17),WOOD)
    p.rod((0,.93,.22),(0,1.39,.46),.18,WOOD,sides=8)
    p.rod((0,1.38,.40),(0,1.36,.81),.197,WOOD,tip=.132,sides=8)
    p.sphere((0,1.38,.829),(.10,.092,.10),RED)
    for s in (-1,1):
        for z in (-.56,.184):
            p.rod((s*.21,.78,z),(s*.24,.075,z+.12),.064,WOOD,sides=6)
            p.box((s*.24,.06,z+.16),(.162,.12,.159),DARK)
        p.rod((s*.07,1.49,.42),(s*.26,1.93,.33),.047,WOOD,sides=6)
        for d,y,z in ((.36,1.89,.21),(.30,1.80,.46),(.22,1.98,.32)):
            p.rod((s*.18,1.70,.385),(s*d,y,z),.031,WOOD,sides=6)
        p.sphere((s*.139,1.42,.615),(.035,.039,.036),DARK)
    p.rod((0,.81,-.70),(0,1.05,-.88),.057,WOOD)


def horse(p,x,z,color=WOOD,ridden=False):
    p.sphere((x,1.34,z),(.37,.39,.91),color)
    p.rod((x,1.46,z+.52),(x,1.98,z+.84),.26,color,tip=.155)
    p.sphere((x,1.94,z+1.02),(.177,.267,.388),color)
    p.sphere((x,1.80,z+1.28),(.143,.125,.21),DARK)
    for dx in (-.178,.178):
        p.rod((x+dx*.55,2.07,z+.95),(x+dx*.76,2.37,z+.87),.061,color,tip=.019)
        p.sphere((x+dx*.91,2.044,z+1.10),(.031,.033,.028),DARK)
        for dz in (-.60,.59):
            hoof_x=x+dx
            hoof_z=z+dz+(.20 if dx>0 else -.087)
            p.rod((x+dx,1.26,z+dz),(hoof_x,.53,hoof_z-.10),.087,color,tip=.071)
            p.rod((hoof_x,.53,hoof_z-.10),(hoof_x,.10,hoof_z),.068,color)
            p.box((hoof_x,.077,hoof_z),(.15,.14,.18),DARK)
    p.rod((x,1.48,z-.80),(x,1.02,z-1.08),.070,DARK)
    p.rod((x,1.03,z-1.08),(x,.80,z-1.18),.057,DARK)
    if ridden:
        p.box((x,1.72,z+.06),(.56,.154,.56),DARK)
        p.sphere((x,2.015,z+.15),(.209,.345,.175),BLUE)
        p.sphere((x,2.38,z+.18),(.151,.164,.152),"#e7bc9a")
        p.sphere((x,2.466,z+.183),(.158,.094,.165),BLUE)
        for dx in (-.34,.34):
            p.rod((x+dx*.36,1.96,z+.12),(x+dx,1.58,z+.25),.067,WHITE)
            p.rod((x+dx,1.58,z+.25),(x+dx*.87,1.41,z-.02),.059,DARK)
            p.rod((x+dx*.43,2.13,z+.20),(x+dx*.27,1.94,z+.62),.058,BLUE)
        p.rod((x-.075,1.94,z+.62),(x-.107,1.88,z+1.19),.013,DARK)
        p.rod((x+.075,1.94,z+.62),(x+.107,1.88,z+1.19),.013,DARK)


def arena(p,kind):
    plate(p,9.5,7.15,"#bc986e")
    for x in (-4.52,4.52):
        rails(p,(x,.1,-3.34),(x,.1,3.35),1.11,WOOD)
    rails(p,(-4.52,.1,-3.34),(4.52,.1,-3.34),1.1,WOOD)
    if kind=="barrel":
        for i,(x,z) in enumerate(((-2.86,.78),(2.82,.78),(0,-2.11))):
            disk(p,x,.099,z,.26,.71,[BLUE, RED, BLUE][i],18)
            for y in (.23,.63):
                disk(p,x,y,z,.267,.053,WHITE,18)
        horse(p,-1.14,.42,WOOD,True)
    elif kind=="horse":
        for x in (-2.59,0,2.59):
            p.box((x,.109,0),(.075,.016,5.76),WHITE)
        for x,z,c in ((-1.36,.29,WOOD),(1.43,-1.15,"#af987b")):
            horse(p,x,z,c,True)
        sign_face(p,"RACE",0,2.24,3.02,1.41,.36)
        for x in (-.82,.82):
            p.rod((x,.1,2.98),(x,2.4,2.98),.034,METAL)
    elif kind=="bull":
        rails(p,(-1.66,.1,-1.07),(1.88,.1,-1.07),1.31,RED)
        p.sphere((0,1.19,.57),(.55,.56,1.16),"#6e4836")
        p.sphere((0,1.31,1.56),(.45,.45,.49),"#6e4836")
        p.sphere((0,1.07,1.78),(.43,.25,.28),"#ac8264")
        for dx in (-.36,.36):
            for dz in (-.21,1.27):
                p.rod((dx,1.24,dz),(dx*1.06,.16,dz-.04),.102,"#6e4836",tip=.073)
            p.rod((dx,.1,1.25),(dx,.22,1.26),.12,DARK)
            p.rod((dx,1.52,1.52),(dx*1.53,1.74,1.59),.105,WHITE,tip=.023)
        person(p,0,1.29,.27,"rider",.64)
    else:
        for x in (-3.0,0,3.0):
            p.box((x,.30,-1.66),(2.06,.46,1.22),WOOD)
        for i,x in enumerate((-3.0,0,3.0)):
            p.sphere((x,.65,-1.64),(.42,.28,.55),[YELLOW,GREEN,RED][i])
            sign_face(p,f"CLASS {i+1}",x,.86,-.985,1.07,.27,GREEN)
        rails(p,(-4.43,.1,.68),(4.43,.1,.68),.78,YELLOW)


def plough(p):
    plate(p,6.5,8.2,"#a97951")
    for x in np.linspace(-2.72,2.72,8):
        p.box((x,.135,-1.00),(.21,.07,5.37),"#754d37")
    for x in (-.61,.61):
        tire(p,x,.63,-.42,.51)
        tire(p,x,.44,1.06,.33)
    p.box((0,.80,.33),(1.09,.57,2.05),GREEN)
    p.box((0,1.17,-.45),(.53,.14,.53),DARK)
    p.rod((.31,1.07,.70),(.31,1.72,.70),.032,METAL)
    p.rod((0,.57,-1.41),(0,.53,-2.01),.060,METAL)
    p.rod((-.85,.47,-2.11),(.85,.47,-2.11),.08,RED)
    for x in (-.67,0,.67):
        p.prism([(x-.23,.14,-2.91),(x+.21,.15,-2.82),(x+.14,.49,-2.21),(x-.22,.35,-2.4)],
                (0,.03,0),METAL)


def display_tent(p,kind):
    plate(p,3.9,3.05,"#a6987f")
    for x in (-1.74,1.74):
        for z in (-1.27,1.27):
            p.rod((x,.1,z),(x,2.25,z),.046,WOOD)
    for end in (-1,1):
        p.mesh([(-1.94,2.66,0),(1.94,2.66,0),(1.94,2.25,end*1.51),(-1.94,2.25,end*1.51)],
               [(0,1,2),(0,2,3)],GREEN if kind in ("flowers","club") else BLUE)
    table(p,0,.55,2.79,.78)
    if kind=="flowers":
        for i,x in enumerate(np.linspace(-1.24,1.24,7)):
            disk(p,x,.804,.55,.136,.19,WOOD)
            for dx in (-.068,0,.068):
                p.rod((x,.91,.55),(x+dx,1.21+.09*abs(dx)/.068,.54),.015,GREEN)
                p.sphere((x+dx,1.22+.09*abs(dx)/.068,.54),(.062,.046,.056),[YELLOW,RED,WHITE][i%3])
        name="FLOWER/SHOW"
    elif kind=="sticks":
        for x in np.linspace(-1.18,.93,9):
            p.rod((x,.105,-.56),(x+.13,1.52,-.47),.031,WOOD)
            p.rod((x+.13,1.51,-.47),(x+.05,1.58,-.43),.031,WOOD)
        for i,x in enumerate((-.63,.13,.77)):
            p.box((x,.85,.57),(.47,.085,.22), [METAL,YELLOW,DARK][i])
        name="STICKMAKERS"
    elif kind=="club":
        for i,x in enumerate((-.77,0,.77)):
            p.box((x,.96,.56),(.52,.32,.42),WOOD)
            for dx in (-.14,.04,.12):
                p.sphere((x+dx,1.134,.54),(.089,.075,.092),[YELLOW,GREEN,RED][i])
        name="YOUNG/FARMERS"
    else:
        for i,x in enumerate(np.linspace(-1.20,1.20,6)):
            disk(p,x,.802,.48,.111,.11,[RED,YELLOW,BLUE][i%3])
            p.rod((x,.86,.71),(x+.17,.85,.86),.018,METAL)
        for x in (-.68,.67):
            p.box((x,.83,.32),(.55,.050,.31),WHITE)
        name="ARTS &/CRAFTS"
    sign_face(p,name,0,2.16,1.48,1.50,.38,GREEN if kind in ("flowers","club") else BLUE)


def hedge(p):
    plate(p,5.8,3.1,GROUND)
    for x in np.linspace(-2.42,2.42,13):
        p.rod((x,.10,-.42),(x,.97,-.42),.034,WOOD)
        p.rod((x,.23,-.49),(x+.32,.56,-.34),.062,GREEN)
        p.sphere((x,.66,-.43),(.27,.29,.25),GREEN if x>0 else "#71855b")
    table(p,1.48,.52,1.45,.62)
    p.rod((1.03,.85,.42),(1.71,.85,.66),.029,WOOD)
    p.rod((1.60,.86,.66),(1.99,.86,.82),.023,METAL)
    signpost(p,"HEDGE/LAYING",-1.96,1.10,GREEN)

def target_range(p,clay):
    plate(p,10.3,13.2,"#8c9a68" if clay else "#939181")
    if clay:
        for x in (-3.05,-1.54,0,1.54,3.05):
            p.box((x,.152,2.67),(1.02,.12,.93),METAL)
        for x in (-4.7,4.7):
            rails(p,(x,.1,1.89),(x,.1,5.9),.97)
        p.box((0,.35,-4.18),(1.24,.51,.78),DARK)
        p.rod((0,.53,-4.18),(.75,.88,-4.09),.053,METAL)
        for x in (-.46,-.25,-.03):
            disk(p,x,.64,-4.32,.113,.045,GOLD_ORANGE,18)
        signpost(p,"CLAY/SHOOTING",3.98,4.88)
        return
    for x in (-4.72,-2.36,0,2.36,4.72):
        p.box((x,1.04,2.95),(.12,1.88,3.91),WOOD)
    p.box((0,1.31,-6.06),(10.13,2.48,1.01),"#8a775e")
    for x in (-3.5,-1.17,1.17,3.5):
        p.rod((x,.10,-4.49),(x,1.80,-4.49),.041,METAL)
        for r, z, c in ((.36,-4.44,WHITE),(.235,-4.428,DARK),(.111,-4.413,RED)):
            p.rod((x,1.44,z),(x,1.44,z+.012),r,c)
        p.box((x,.83,2.72),(1.75,.10,.38),METAL)


def mirror_maze(p):
    plate(p,7.2,6.20,DARK)
    # A cutaway keeps the passages legible in the overhead planning view.
    for a,b in (
        ((-3.32,-2.78),(3.33,-2.78)),((-3.32,-2.78),(-3.32,2.78)),
        ((3.33,-2.78),(3.33,2.78)),((-3.32,2.78),(-.88,2.78)),
        ((.91,2.78),(3.33,2.78)),((-2.08,-1.40),(1.11,-1.40)),
        ((1.11,-1.40),(1.11,.71)),((-2.14,-.21),(-.72,1.29)),
        ((-.72,1.29),(2.44,1.29)),((-.62,-2.78),(-.62,-1.40)),
    ):
        x1,z1=a
        x2,z2=b
        points=[(x1,.12,z1),(x2,.12,z2),(x2,2.13,z2),(x1,2.13,z1)]
        p.mesh(points,[(0,1,2),(0,2,3)],"#8eb2c6")
        for x,z in (a,b):
            p.rod((x,.10,z),(x,2.14,z),.058,DARK)
        p.rod((x1,2.13,z1),(x2,2.13,z2),.035,BLUE)
    sign_face(p,"MIRROR/MAZE",0,2.28,2.82,1.71,.40)


def paratrooper(p):
    # Oblique rotating wheel and suspended, parachute-canopied seats.
    # Reference: Fairground Heritage Trust, Riding to Infinity & Beyond.
    disk(p,0,0,0,4.42,.14,DARK)
    p.rod((0,.14,0),(0,5.32,0),.25,METAL)
    p.rod((0,5.0,0),(0,5.78,0),.40,BLUE)
    radius=3.55
    points=[(radius*math.cos(t),5.35+radius*math.sin(t)*.44,radius*math.sin(t)*.898)
            for t in np.linspace(0,math.tau,13)]
    for i,(a,b) in enumerate(zip(points,points[1:])):
        p.rod(a,b,.088,YELLOW)
        p.rod((0,5.35,0),a,.052,METAL)
        if i%2:
            continue
        x,y,z=a
        p.rod((x,y,z),(x,y-.79,z),.032,DARK)
        p.rod((x,y-.72,z),(x,y-.90,z),.47,RED if i%4 else BLUE,tip=.53,sides=18)
        for s in (-1,1):
            p.rod((x+s*.39,y-.82,z),(x+s*.36,y-1.80,z),.017,METAL)
        p.box((x,y-1.79,z),(.77,.12,.49),RED if i%4 else BLUE)
        p.box((x,y-1.54,z-.21),(.77,.42,.071),BLUE)
        p.rod((x-.36,y-1.50,z+.18),(x+.36,y-1.50,z+.18),.024,METAL)
    sign_face(p,"PARATROOPER",0,1.74,3.89,1.80,.38,BLUE)


def fairground(p,park):
    plate(p,12.0,9.5,"#9eab8f" if park else "#b1a38f")
    for x in (-4.57,4.57):
        p.box((x,.61,2.61),(2.28,1.03,1.70),RED if park else BLUE)
        for s in (-1,1):
            p.rod((x+s*1.04,.09,2.27),(x+s*1.04,2.53,2.27),.051,METAL)
        p.box((x,2.50,2.54),(2.37,.17,1.93),WHITE)
        for j in range(8):
            p.box((x-.99+j*.282,2.598,2.54),(.133,.018,1.92),RED)
    for x in (-2.40,2.40):
        p.rod((x,.1,3.65),(x,3.18,3.65),.077,BLUE)
    sign_face(p,"THEME PARK" if park else "CARNIVAL",0,3.06,3.75,4.70,.58,BLUE if park else RED)
    if park:
        track=[(-4.88,.76,-2.57),(-3.29,1.25,-3.68),(-1.23,3.42,-3.91),
               (.41,4.62,-3.91),(1.6,4.11,-3.82),(3.44,1.12,-3.04),(4.63,.76,-2.03)]
        for a,b in zip(track,track[1:]):
            for dz in (-.16,.16):
                p.rod(np.asarray(a)+(0,0,dz),np.asarray(b)+(0,0,dz),.046,RED)
            p.rod((a[0],.10,a[2]),a,.063,METAL)
        p.rod((4.63,.1,-2.03),track[-1],.063,METAL)
    else:
        for a,b in zip([(-4,2.84,-1.7),(-2,2.45,-1.7),(0,2.69,-1.7),(2,2.45,-1.7)],
                       [(-2,2.45,-1.7),(0,2.69,-1.7),(2,2.45,-1.7),(4,2.84,-1.7)]):
            p.rod(a,b,.019,DARK)
            for i in range(3):
                x,y,z=np.asarray(a)+(np.asarray(b)-a)*(i+.5)/3
                p.prism([(x-.17,y,z),(x+.17,y,z),(x,y-.34,z)],(0,0,.024),[BLUE,RED,YELLOW][i])
        for x in (-4,4):
            p.rod((x,.1,-1.7),(x,2.85,-1.7),.055,METAL)


def zoo_gate(p):
    plate(p,8.4,6.1,GROUND)
    for x in (-2.44,2.44):
        p.box((x,1.49,1.64),(.73,2.79,.83),WOOD)
        rails(p,(x*1.1,.1,-2.51),(x*1.1,.1,1.57),1.44,WOOD)
    p.box((0,2.93,1.64),(5.49,.33,.74),WOOD)
    sign_face(p,"ZOO",0,3.12,2.04,2.5,.66,GREEN)
    for x,z in ((-3.12,-.79),(3.38,1.0),(3.11,-1.62),(-3.30,-2.27)):
        p.rod((x,.10,z),(x,2.44,z),.14,WOOD)
        p.sphere((x,2.34,z),(.56,.76,.56),GREEN)
    p.box((0,.126,-.25),(3.21,.067,5.06),"#b3a288")


def fireworks(p):
    plate(p,2.52,2.18,DARK)
    for i,(x,z) in enumerate(((-.55,.42),(.54,.42),(0,-.55))):
        p.box((x,.29,z),(.75,.38,.639),WOOD)
        for dx in (-.21,0,.21):
            p.rod((x+dx,.46,z),(x+dx,.87+(i%2)*.09,z),.083,RED if i%2 else METAL)
            p.rod((x+dx,.87+(i%2)*.09,z),(x+dx,1.00+(i%2)*.09,z),.084,YELLOW,tip=.014)
    signpost(p,"FIREWORKS/SETUP",.54,-.73,RED)


def vintage(p):
    plate(p,4.5,3.28,"#a49a8b")
    p.box((0,1.07,-1.50),(4.18,1.93,.14),WOOD)
    sign_face(p,"VINTAGE/DISPLAY",0,1.98,-1.42,1.77,.41,DARK)
    table(p,0,-.11,3.41,.91)
    p.box((-.84,1.01,-.10),(.79,.39,.40),WOOD)
    p.rod((-.87,.968,.105),(-.87,.968,.159),.109,YELLOW)
    p.box((.56,.99,-.10),(.63,.34,.38),DARK)
    p.rod((.55,1.10,.10),(.55,1.10,.177),.12,METAL)
    p.rod((.55,1.10,.177),(.55,1.10,.185),.082,DARK)
    p.rod((1.20,.88,-.06),(1.21,1.38,.08),.04,YELLOW)
    p.rod((1.20,1.34,.08),(1.20,1.37,.35),.051,YELLOW,tip=.156)


def prosecco_bar(p):
    plate(p,3.78,2.75,"#a6a49a")
    p.box((0,.58,.51),(3.46,1.03,.78), "#5e867a")
    p.box((0,1.12,.51),(3.57,.11,.90),WOOD)
    p.box((0,1.11,-.98),(3.34,1.92,.16),WOOD)
    for y in (.71,1.20):
        p.box((0,y,-.86),(3.12,.064,.34),WOOD)
        for x in np.linspace(-1.29,1.29,8):
            disk(p,x,y+.034,-.85,.064,.20,GREEN,12)
            disk(p,x,y+.234,-.85,.031,.092,YELLOW,12)
    for x in (-.71,0,.71):
        disk(p,x,1.174,.51,.076,.024,METAL)
        disk(p,x,1.197,.51,.016,.11,METAL)
        p.rod((x,1.304,.51),(x,1.462,.51),.043,tip=.062,color="#ddc68a",sides=14)
    sign_face(p,"PROSECCO",0,1.89,-.879,1.66,.35,GREEN)


def plan_shape(p,kind):
    # User-authored images, labels and routes keep their own editing semantics.
    # The library GLBs are sample footprints at a usable map scale.
    if kind.startswith("route-"):
        if kind=="route-solid":
            p.box((0,.013,0),(.36,.026,3.8),BLUE)
        elif kind=="route-dash":
            for z in (-1.58,-.79,0,.79,1.58):
                p.box((0,.013,z),(.36,.026,.46),BLUE)
        else:
            for z in np.linspace(-1.66,1.66,9):
                disk(p,0,0,z,.169,.026,BLUE,18)
        return
    if kind in ("circle","ellipse","chequered-circ"):
        w,d=(1.05, .65) if kind=="ellipse" else (1.,1.)
        if kind!="chequered-circ":
            outline=[(w*math.cos(a),0,d*math.sin(a)) for a in np.linspace(0,math.tau,36,endpoint=False)]
            p.prism(outline,(0,.033,0),BLUE)
            return
        checker_circle(p)
        return
    if kind in ("triangle","triangle-equilateral"):
        d=math.sqrt(3) if kind.endswith("equilateral") else 2.0
        p.prism([(-1,0,-d/2),(1,0,-d/2),(0,0,d/2)],(0,.030,0),BLUE)
        return
    if kind=="chequered-rect":
        for i in range(4):
            for j in range(8):
                p.box(((i-1.5)*.25,.015,(j-3.5)*.25),(.25,.030,.25), WHITE if (i+j)%2 else DARK)
        return
    if kind=="rectangle":
        plate(p,2.2,1.4,BLUE,.033)
        return
    if kind=="transparent":
        for x in (-.95,.95):
            for z in (-.65,.65):
                p.box((x,.014,z),(.17,.028,.041),METAL)
                p.box((x,.014,z),(.041,.028,.17),METAL)
        return
    if kind=="overlayimage":
        plate(p,2.45,1.56,WHITE,.042)
        p.box((0,.026,0),(2.31,.015,1.42),"#a5ced8")
        p.prism([(-.91,.035,.47),(-.15,.035,-.37),(.64,.035,.47)],(0,.008,0),GREEN)
        p.prism([(-.32,.043,.48),(.53,.043,-.19),(.99,.043,.48)],(0,.008,0),"#81a16d")
        disk(p,.76,.035,-.45,.16,.012,YELLOW,20)
        return
    plate(p,2.11,1.18,BLUE,.047)
    p.label([(-.94,.050,.49),(.94,.050,.49),(.94,.050,-.49),(-.94,.050,-.49)],
            "TEXT BOX",WHITE,DARK)


def checker_circle(p):
    def clip(poly, axis, bound, side):
        result = []
        for start, end in zip(poly, poly[1:] + poly[:1]):
            start_in = (start[axis] - bound) * side >= 0
            end_in = (end[axis] - bound) * side >= 0
            if start_in != end_in:
                t = (bound - start[axis]) / (end[axis] - start[axis])
                result.append(tuple(a + (b - a) * t for a, b in zip(start, end)))
            if end_in:
                result.append(end)
        return result

    # Angular half-step avoids duplicate polygon corners at the tile boundaries.
    outline = [(math.cos(a), math.sin(a))
               for a in np.linspace(0, math.tau, 64, endpoint=False) + math.pi / 64]
    for x in range(8):
        for z in range(8):
            polygon = outline
            for axis, cell in enumerate((x, z)):
                polygon = clip(polygon, axis, cell / 4 - 1, 1)
                polygon = clip(polygon, axis, (cell + 1) / 4 - 1, -1)
            if len(polygon) >= 3:
                p.prism([(u, 0, v) for u, v in polygon], (0, .024, 0),
                        WHITE if (x + z) % 2 else DARK)


COMPLETION_PROPS = {
    "course-crossroad-a": ("sports", lambda p: course_crossing(p,False)),
    "course-crossroad-b": ("sports", lambda p: course_crossing(p,True)),
    "ski-paramedic": ("people", ski_medic),
    "tunnel-entry-exit": ("structure", tunnel),
    "candied-fruits": ("food", fruit_bowl),
    "crokicurl": ("sports", lambda p: ice_rink(p,True)),
    "elf": ("people", lambda p: person(p,0,0,0,"elf")),
    "ice-skating": ("sports", ice_rink),
    "inflatable-santa": ("decor", santa),
    "nativity-scene": ("decor", nativity),
    "wooden-rudolf": ("decor", reindeer),
    "boundary-calculator-men": ("sports", lambda p: cricket_boundary(p,False)),
    "boundary-calculator-women": ("sports", lambda p: cricket_boundary(p,True)),
    "slips": ("sports", cricket_camera),
    "stroller-storage": ("logistics", stroller_store),
    "mixed-relay-zone": ("sports", lambda p: racer_zone(p,"mixed")),
    "paramedic-motorbike": ("vehicles", rescue_motorcycle),
    "relay-handover": ("sports", lambda p: racer_zone(p,"handover")),
    "special-needs": ("sports", lambda p: racer_zone(p,"personal")),
    "swim-evacuation-point": ("logistics", lambda p: river_crossing(p,True)),
    "transition-zone": ("sports", lambda p: racer_zone(p,"transition")),
    "tv-boat": ("vehicles", lambda p: boat(p,"tv")),
    "water-crossing": ("structure", river_crossing),
    "agricultural-competition": ("exhibition", lambda p: arena(p,"agriculture")),
    "barrel-racing": ("sports", lambda p: arena(p,"barrel")),
    "bull-riding": ("sports", lambda p: arena(p,"bull")),
    "clay-pigeon-shooting": ("sports", lambda p: target_range(p,True)),
    "floriculture": ("plants", lambda p: display_tent(p,"flowers")),
    "hedgelaying": ("plants", hedge),
    "horse-racing": ("sports", lambda p: arena(p,"horse")),
    "mirror-maze": ("rides", mirror_maze),
    "paratrooper": ("rides", paratrooper),
    "ploughing": ("sports", plough),
    "rodeo-clown": ("people", lambda p: person(p,0,0,0,"clown")),
    "stickmakers-guild": ("exhibition", lambda p: display_tent(p,"sticks")),
    "young-farmers-club": ("exhibition", lambda p: display_tent(p,"club")),
    "shooting-range": ("sports", lambda p: target_range(p,False)),
    "airport": ("structure", lambda p: transport(p,"airport")),
    "bus-coach-station": ("structure", lambda p: transport(p,"bus")),
    "train-station": ("structure", lambda p: transport(p,"station")),
    "lifeguard-kayak": ("vehicles", lambda p: boat(p,"rescue")),
    "arts-and-crafts": ("exhibition", lambda p: display_tent(p,"craft")),
    "carnival": ("rides", lambda p: fairground(p,False)),
    "fireworks": ("decor", fireworks),
    "hospital": ("structure", hospital),
    "multi-faith-room": ("structure", lambda p: cabin_room(p,False)),
    "relax-zone": ("structure", rest_area),
    "themepark": ("rides", lambda p: fairground(p,True)),
    "timing-point": ("sports", timing_station),
    "vintage-display": ("exhibition", vintage),
    "zoo": ("structure", zoo_gate),
    "changing-places-toilet": ("structure", lambda p: cabin_room(p,True)),
    "fire-towers": ("structure", lookout),
    "risk-assessment-pin": ("signage", risk_pin),
    "firewall": ("digital", lambda p: network(p,"firewall")),
    "generator-point": ("logistics", lambda p: network(p,"generator")),
    "permanent-power": ("logistics", lambda p: network(p,"mains")),
    "coach": ("vehicles", coach),
    "spitfire-aircraft": ("vehicles", spitfire),
    "camera-boat": ("vehicles", lambda p: boat(p,"camera")),
    "skycam": ("digital", skycam),
    "prosecco-bar": ("food", prosecco_bar),
}

PLAN_SHAPES = (
    "chequered-circ", "chequered-rect", "circle", "ellipse", "overlayimage",
    "rectangle", "route-dash", "route-dot", "route-solid", "textbox",
    "transparent", "triangle", "triangle-equilateral",
)
for slug in PLAN_SHAPES:
    COMPLETION_PROPS[slug] = ("decor", lambda p,kind=slug: plan_shape(p,kind))

DESIGN_REFERENCES = {
    "crokicurl": "https://www.publiccityarchitecture.com/crokicurl",
    "paratrooper": "https://www.fairground-heritage.org.uk/learning/riding-to-infinity-beyond/",
    "spitfire-aircraft": "https://www.sciencemuseum.org.uk/sites/default/files/2025-11/Flight-Large%20Print%20Book%202%20of%203-DIGITAL.pdf",
}
