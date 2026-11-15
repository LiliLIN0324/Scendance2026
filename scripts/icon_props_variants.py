"""Alternate builds for objects whose physical variants matter in a site plan."""
import math

import numpy as np

from icon_props_completion import (
    BLUE, DARK, GREEN, METAL, RED, WHITE, WOOD, YELLOW,
    bench, camera, disk, plate, rails, sign_face, table, tire,
)


def compact_medical(p):
    plate(p, 2.75, 2.25, "#9aa09c")
    for x in (-1.18, 1.18):
        for z in (-.95, .95):
            p.rod((x, .1, z), (x, 2.13, z), .037, METAL)
    corners = [(-1.32, 2.10, -.98), (1.32, 2.10, -.98),
               (1.32, 2.10, .98), (-1.32, 2.10, .98)]
    for a, b in zip(corners, corners[1:] + corners[:1]):
        p.mesh([a, b, (0, 2.65, 0)], [(0, 1, 2)], WHITE)
    sign_face(p, "FIRST AID", 0, 2.11, 1.00, 1.60, .31, RED)
    table(p, 0, -.59, 1.75, .61, WHITE)
    for x in (-.53, .45):
        p.box((x, .91, -.57), (.46, .21, .38), RED)
        p.box((x, .92, -.374), (.15, .036, .012), WHITE)
        p.box((x, .92, -.371), (.035, .15, .012), WHITE)
    bench(p, -.51, .39)
    p.box((.92, .51, .18), (.49, .83, .49), WHITE)
    p.box((.92, .87, .44), (.30, .12, .04), RED)


def coffee_trailer(p):
    p.box((0, .65, 0), (1.85, .22, 3.62), DARK)
    p.box((0, 1.48, 0), (1.86, 1.59, 3.61), "#4b7770")
    p.box((0, 2.31, 0), (1.91, .11, 3.65), WHITE)
    for x in (-.92, .92):
        tire(p, x, .34, -.19, .33)
    for x in (-.62, .62):
        p.rod((x, .53, 1.62), (0, .52, 2.63), .065, METAL)
    p.rod((0, .1, 2.48), (0, .53, 2.48), .030, METAL)
    p.box((.935, 1.73, .06), (.023, .65, 1.92), DARK)
    p.prism([(.946, 2.07, -.94), (.946, 2.07, 1.04),
             (1.54, 2.40, 1.04), (1.54, 2.40, -.94)], (0, .049, 0), WHITE)
    p.box((1.08, 1.35, .07), (.31, .068, 1.96), WOOD)
    p.box((1.18, 1.51, .64), (.28, .25, .44), METAL)
    for z in (.52, .73):
        disk(p, 1.17, 1.40, z, .057, .12, WHITE)
    sign_face(p, "COFFEE", 0, 1.91, 1.821, .99, .32, "#4b7770")


def camera_catamaran(p):
    for x in (-.73, .73):
        # Closed fiberglass floats and a raised platform give the camera a stable base.
        p.sphere((x, .37, 0), (.42, .35, 2.27), BLUE)
        p.box((x, .59, -.21), (.61, .14, 3.42), WHITE)
    p.box((0, .74, -.12), (1.83, .17, 2.94), WOOD)
    for x in (-.87, .87):
        rails(p, (x, .82, -1.44), (x, .82, 1.21), .46)
    p.box((0, 1.01, .49), (1.05, .34, .86), METAL)
    camera(p, 0, 1.19, .52)
    p.box((0, 1.05, -1.10), (.57, .42, .55), WHITE)
    p.box((0, 1.13, -1.42), (.44, .16, .058), DARK)


def led_checkpoint(p):
    plate(p, 5.2, 3.1, "#a2a6a0")
    for center in (-1.30, 1.30):
        for x in (center-.49, center+.49):
            p.box((x, 1.12, -.44), (.13, 2.04, .31), METAL)
        p.box((center, 2.14, -.44), (1.10, .17, .31), METAL)
        p.box((center+.31, 1.85, -.264), (.18, .11, .038), GREEN)
        table(p, center+.51, .64, .61, 1.24, WHITE)
        p.box((center+.51, .87, .67), (.43, .13, .41), DARK)
    for x in (-2.43, 2.43):
        rails(p, (x, .1, -.75), (x, .1, 1.42), .87)
    sign_face(p, "BAG CHECK", 0, 2.43, -.25, 1.53, .37)


def double_refill(p):
    for x in (-.27, .27):
        h = 1.15 if x > 0 else .88
        p.box((x, h/2, 0), (.49, h, .46), METAL)
        p.box((x, h-.12, .15), (.405, .23, .15), "#415861")
        p.box((x, h-.23, .21), (.41, .046, .22), WHITE)
        p.rod((x, h, .24), (x, h-.11, .24), .035, METAL)
        p.box((x, h-.43, .238), (.31, .12, .018), BLUE)
    sign_face(p,"REFILL",0,1.25,-.058,.74,.24)


def dual_ev(p):
    plate(p, 1.77, .83, "#929a9a")
    for x in (-.43, .43):
        p.box((x, .74, 0), (.54, 1.28, .37), WHITE)
        p.box((x, 1.43, 0), (.56, .14, .40), GREEN)
        p.box((x, 1.09, .196), (.37, .37, .06), DARK)
        p.box((x, 1.13, .234), (.23, .12, .019), "#72c4c1")
        points = [(x+.21, 1.22, .214), (x+.31, .54, .24), (x+.25, .39, .24),
                  (x+.10, .52, .255), (x+.087, .98, .263)]
        for a,b in zip(points,points[1:]):
            p.rod(a,b,.025,DARK)
    for x in (-.80,.80):
        p.rod((x,.1,.30),(x,.68,.30),.046,YELLOW)


def umbrella_table(p):
    for i in range(5):
        angle=i*math.tau/5
        s,c=math.sin(angle),math.cos(angle)
        x,z=1.05*s,1.05*c
        p.box((x,.44,z), (.45,.09,.44), WOOD)
        p.box((x+.09*s,.72,z+.09*c), (.37,.23,.19), WOOD)
        for dx in (-.15,.15):
            for dz in (-.14,.14):
                p.rod((x+dx,0,z+dz),(x+dx,.43,z+dz),.024,METAL)
    disk(p,0,0,0,.38,.066,METAL)
    p.rod((0,.065,0),(0,2.65,0),.036,METAL)
    disk(p,0,.72,0,.69,.055,WOOD)
    for i in range(12):
        a,b=i*math.tau/12,(i+1)*math.tau/12
        p.mesh([(0,2.63,0),(1.33*math.cos(a),2.19,1.33*math.sin(a)),
                (1.33*math.cos(b),2.19,1.33*math.sin(b))],[(0,1,2)], BLUE if i%2 else WHITE)


def info_booth(p):
    plate(p, 1.83, 1.40, "#a1a2a0")
    p.box((0,.52,.26),(1.68,.86,.69),BLUE)
    p.box((0,.99,.26),(1.75,.1,.76),WHITE)
    p.box((0,1.25,-.63),(1.68,2.29,.11),WHITE)
    for x in (-.78,.78):
        p.rod((x,.10,.48),(x,2.43,.48),.047,METAL)
    p.box((0,2.44,-.06),(1.80,.12,1.38),BLUE)
    sign_face(p,"INFORMATION",0,2.40,.66,1.54,.31)
    p.box((-.54,1.18,.17),(.24,.34,.12),DARK)
    p.box((.44,1.08,.21),(.30,.08,.31),WHITE)


def outdoor_lounge(p):
    plate(p, 4.8, 4.2, "#a7a294")
    for x in (-1.86, 1.86):
        for z in (-1.64, 1.64):
            p.rod((x,.1,z),(x,2.47,z),.046,METAL)
    for i in range(7):
        z=-1.73+i*.51
        p.box((0,2.49,z),(3.92,.072,.49),GREEN if i%2 else WHITE)
    for x in (-1.27,1.27):
        p.box((x,.32,-.77),(1.72,.44,.63),WOOD)
        p.box((x,.57,-.77),(1.67,.17,.65),GREEN)
        p.box((x,.79,-1.04),(1.71,.26,.16),GREEN)
        table(p,x,.35,.76,.56)
        disk(p,x,.805,.35,.105,.037,WHITE)


def two_lane_ramp(p):
    for x in (-.84,.84):
        p.prism([(x-.72,0,2.16),(x+.72,0,2.16),(x+.72,.62,-1.50),
                 (x-.72,.62,-1.50)], (0,.075,0),METAL)
        p.box((x,.643,-1.95),(1.44,.13,.93),METAL)
    for x in (-1.58,0,1.58):
        rails(p,(x,.066,2.11),(x,.689,-1.49),.87,BLUE)
        rails(p,(x,.689,-1.49),(x,.689,-2.38),.87,BLUE)


def wrapped_bouncer(p):
    plate(p, 4.18, 4.76, BLUE,.42)
    for x in (-1.87,1.87):
        for z in (-1.93,1.93):
            p.rod((x,.42,z),(x,2.56,z),.28,YELLOW)
            p.sphere((x,2.54,z),(.28,.33,.28),RED)
        for z in np.linspace(-1.78,1.78,23):
            p.rod((x,.56,z),(x,2.08,z),.008, DARK,sides=6)
        for y in (.55,2.14):
            p.rod((x,y,-1.84),(x,y,1.84),.17,YELLOW)
    for z in (-2.02,2.02):
        p.mesh([(-1.98,2.50,z),(0,3.03,z),(1.98,2.50,z)],[(0,1,2)],RED)
    for x in (-1,1):
        p.mesh([(0,3.03,-2.04),(x*1.98,2.50,-2.04),(x*1.98,2.50,2.04),(0,3.03,2.04)],
               [(0,1,2),(0,2,3)],RED)
    p.box((0,.26,2.44),(1.17,.52,.80),YELLOW)


def round_lantern(p):
    for i in range(12):
        a,b=math.pi*i/12,math.pi*(i+1)/12
        ra,rb=max(.055,.38*math.sin(a)),max(.055,.38*math.sin(b))
        p.rod((0,.43-.31*math.cos(a),0),(0,.43-.31*math.cos(b),0),ra,RED,tip=rb,sides=24)
    disk(p,0,.73,0,.107,.055,YELLOW)
    disk(p,0,.083,0,.107,.048,YELLOW)
    p.rod((0,.785,0),(0,.94,0),.020,RED)
    for i in range(6):
        x=(i-2.5)*.022
        p.rod((x,.095,0),(x*1.18,0,0),.007,YELLOW)


# Key is the variant's local asset slug suffix. The icon key is the exact shared object identity.
VARIANT_PROPS = {
    "first-aid-point-compact": ("first-aid-point", "便携急救站（紧凑型）", "Compact first aid station", "logistics", compact_medical),
    "food-trailer-coffee": ("food-trailer", "咖啡餐饮拖车", "Coffee concession trailer", "vehicles", coffee_trailer),
    "camera-boat-catamaran": ("camera-boat", "双体摄像船", "Camera catamaran", "vehicles", camera_catamaran),
    "security-checkpoint-dual": ("security-checkpoint", "双通道安检点", "Dual-lane security checkpoint", "structure", led_checkpoint),
    "water-refill-station-dual": ("water-refill-station", "双龙头补水站", "Dual-height bottle refill station", "logistics", double_refill),
    "ev-charge-point-dual": ("ev-charge-point", "双机充电桩", "Twin EV charging point", "digital", dual_ev),
    "round-table-and-chairs-parasol": ("round-table-and-chairs", "户外圆桌椅（带伞）", "Round table and chairs with parasol", "tables", umbrella_table),
    "information-point-booth": ("information-point", "问询服务亭", "Information booth", "exhibition", info_booth),
    "relax-zone-lounge": ("relax-zone", "双沙发遮阳休息区", "Covered two-sofa lounge", "structure", outdoor_lounge),
    "accessible-ramp-dual": ("accessible-ramp", "双通道无障碍坡道", "Twin-lane access ramp", "structure", two_lane_ramp),
    "bouncy-castle-roofed": ("bouncy-castle", "带顶充气城堡", "Roofed bouncy castle", "rides", wrapped_bouncer),
    "cn-lantern-round": ("cn-lantern", "圆鼓红灯笼", "Round red festive lantern", "decor", round_lantern),
}
