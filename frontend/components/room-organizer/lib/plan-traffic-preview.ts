import { routeCarrier, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import { PLAN_VEHICLE_SLUGS } from './oneplan-catalog';
import { builtinModelBySlug, facilityTemplateSlug, resolveFacilityModels } from './plan-facility-models';
import { nearestRouteEntry, worldPreviewRoute } from './plan-crowd-routes';
import { routeLength } from './person-route';
import type { FurnitureItem, WalkRoute } from './types';
import { walkRoleGlbUrl } from './walk-roles';
import { defaultPersonForType } from './people-registry';

export interface TrafficPreview {
  routeId: string;
  kind: 'vehicle' | 'trolley' | 'pedestrian';
  item: FurnitureItem;
  route: WalkRoute;
  sourceFacilityId?: string;
}

export function planTrafficPreviews(plan: Pick<SitePlanData, 'facilities' | 'routes'>): TrafficPreview[] {
  const routes = plan.routes.flatMap(planRoute => {
    const route = worldPreviewRoute(planRoute);
    return route ? [{ planRoute, route, carrier: routeCarrier(planRoute) }] : [];
  });
  const vehicleRoutes = routes.filter(({ carrier }) => carrier === 'vehicle' || carrier === 'mixed');
  const vehicleByRoute = new Map<string, { facilityId: string; distance: number; along: number; templateId: string; override?: string | undefined }>();

  for (const facility of plan.facilities) {
    const slug = facilityTemplateSlug(facility.templateId);
    const vehicle = PLAN_VEHICLE_SLUGS.find(entry => entry.slug === slug);
    if (!vehicle || /trailer|bicycle/.test(vehicle.slug)) continue;
    const eligible = vehicleRoutes.filter(({ planRoute }) => (
      planRoute.kind === 'service' ? vehicle.group === 'service' : vehicle.group === 'passenger'
    ));
    const nearest = eligible.map(({ planRoute, route }) => ({
      id: planRoute.id,
      ...nearestRouteEntry(route.points, { x: facility.position.x, z: -facility.position.y }),
    })).sort((a, b) => a.distance - b.distance)[0];
    if (!nearest || nearest.distance >= (vehicleByRoute.get(nearest.id)?.distance ?? Infinity)) continue;
    vehicleByRoute.set(nearest.id, {
      ...nearest, facilityId: facility.id, templateId: facility.templateId, override: facility.modelOverride,
    });
  }

  return routes.flatMap(({ planRoute, route, carrier }) => {
    const previews: TrafficPreview[] = [];
    const id = planRoute.id;
    const length = routeLength(route.points, false);
    if (carrier === 'vehicle' || carrier === 'mixed') {
      const vehicle = vehicleByRoute.get(id);
      const selectedModel = vehicle
        ? (vehicle.override ? builtinModelBySlug(vehicle.override) : null) ?? resolveFacilityModels(vehicle.templateId)[0]
        : null;
      const model = selectedModel ?? builtinModelBySlug(planRoute.kind === 'service'
        ? 'car-park-and-road-vehicle-fleet-box-truck-4574c765'
        : 'car-park-and-road-vehicle-fleet-saloon-ad831b1f');
      if (model) {
        previews.push({
          routeId: id, kind: 'vehicle', route: { ...route, startDistance: vehicle?.along ?? 0, speed: 3 },
          ...(vehicle ? { sourceFacilityId: vehicle.facilityId } : {}),
          item: {
            id: `traffic-vehicle-${id}`, type: 'glb-asset', icon: '', color: '#7558a2', name: model.name,
            width: model.width, height: model.height, depth: model.depth,
            glbUrl: model.glbUrl, assetId: model.slug, uniformScale: true,
          },
        });
      }
    }
    if (carrier === 'trolley' || (planRoute.kind === 'service' && carrier === 'mixed')) {
      const slug = 'low-poly-character-figures-civilian-pushing-trolley-02fba33e';
      const offset = carrier === 'mixed' ? ((vehicleByRoute.get(id)?.along ?? 0) + length / 2) % length : 0;
      previews.push({
        routeId: id, kind: 'trolley', route: { ...route, startDistance: offset, speed: 0.9 },
        item: {
          id: `traffic-trolley-${id}`, name: '后勤推车', type: 'glb-asset', icon: '', color: '#b88632',
          width: 0.8, height: 1.7, depth: 1.45, assetId: slug,
          glbUrl: `/showcase/assets/library/model/${slug}.glb`, uniformScale: true,
        },
      });
    }
    if (planRoute.kind === 'service' && carrier === 'walk') {
      const assetId = defaultPersonForType('volunteer')?.assetId;
      if (assetId) {
        previews.push({
          routeId: id, kind: 'pedestrian', route: { ...route, startDistance: 0 },
          item: {
            id: `traffic-walker-${id}`, name: '后勤步行', type: 'glb-asset', icon: '', color: '#b88632',
            width: 0.6, height: 1.75, depth: 0.6, assetId,
            glbUrl: walkRoleGlbUrl(assetId), uniformScale: true,
          },
        });
      }
    }
    return previews;
  });
}
