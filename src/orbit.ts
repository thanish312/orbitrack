import * as THREE from 'three';
import * as satellite from 'satellite.js';

export const WGS84_A = 6378.137;
export const WGS84_B = 6356.7523142;
export const MU = 398600.4418;
export const J2 = 1.08262668e-3;
export const EARTH_ROTATION_RAD_S = 7.2921159e-5;
export const SCALE = 0.001;

const RAD2DEG = 180 / Math.PI;
const MI_PER_KM = 0.621371;
const RHO_0 = 1.225;
const H_SCALE_KM = 8.5;
const DEFAULT_CD = 2.2;
const DEFAULT_AREA_TO_MASS = 0.01;

export type UnitSystem = 'metric' | 'imperial';

export interface OrbitalTelemetry {
  altitudeKm: number;
  apogeeKm: number | null;
  perigeeKm: number | null;
  eccentricity: number;
  groundPointEcf: satellite.EcfVec3<number>;
  inclinationDeg: number;
  latitudeDeg: number;
  longitudeDeg: number;
  orbitalPeriodMinutes: number | null;
  speedKmS: number;
}

export interface DeploymentState {
  positionEci: THREE.Vector3;
  velocityEci: THREE.Vector3;
}

export function computeTelemetry(
  positionEci: THREE.Vector3,
  velocityEci: THREE.Vector3,
  gmst: number,
): OrbitalTelemetry {
  const eci = toSatelliteVector(positionEci);
  const geodetic = satellite.eciToGeodetic(eci, gmst);
  const groundPointEcf = satellite.geodeticToEcf({
    latitude: geodetic.latitude,
    longitude: geodetic.longitude,
    height: 0,
  });

  const radius = positionEci.length();
  const speed = velocityEci.length();
  const energy = (speed * speed) / 2 - MU / radius;
  const semiMajorAxis = energy < 0 ? -MU / (2 * energy) : null;
  const eccentricityVector = computeEccentricityVector(positionEci, velocityEci);
  const eccentricity = eccentricityVector.length();
  const angularMomentum = positionEci.clone().cross(velocityEci);
  const inclination = Math.acos(THREE.MathUtils.clamp(angularMomentum.z / angularMomentum.length(), -1, 1)) * RAD2DEG;

  return {
    altitudeKm: geodetic.height,
    apogeeKm: semiMajorAxis ? semiMajorAxis * (1 + eccentricity) - WGS84_A : null,
    perigeeKm: semiMajorAxis ? semiMajorAxis * (1 - eccentricity) - WGS84_A : null,
    eccentricity,
    groundPointEcf,
    inclinationDeg: inclination,
    latitudeDeg: geodetic.latitude * RAD2DEG,
    longitudeDeg: geodetic.longitude * RAD2DEG,
    orbitalPeriodMinutes: semiMajorAxis ? (2 * Math.PI * Math.sqrt((semiMajorAxis ** 3) / MU)) / 60 : null,
    speedKmS: velocityEci.length(),
  };
}

export function propagateState(
  state: DeploymentState,
  dtSeconds: number,
  useDrag: boolean,
): DeploymentState {
  const position = state.positionEci.clone();
  const velocity = state.velocityEci.clone();

  const k1v = acceleration(position, velocity, useDrag);
  const k1p = velocity.clone();

  const k2pState = position.clone().addScaledVector(k1p, dtSeconds / 2);
  const k2vState = velocity.clone().addScaledVector(k1v, dtSeconds / 2);
  const k2v = acceleration(k2pState, k2vState, useDrag);
  const k2p = k2vState.clone();

  const k3pState = position.clone().addScaledVector(k2p, dtSeconds / 2);
  const k3vState = velocity.clone().addScaledVector(k2v, dtSeconds / 2);
  const k3v = acceleration(k3pState, k3vState, useDrag);
  const k3p = k3vState.clone();

  const k4pState = position.clone().addScaledVector(k3p, dtSeconds);
  const k4vState = velocity.clone().addScaledVector(k3v, dtSeconds);
  const k4v = acceleration(k4pState, k4vState, useDrag);
  const k4p = k4vState.clone();

  velocity.add(
    k1v
      .addScaledVector(k2v, 2)
      .addScaledVector(k3v, 2)
      .add(k4v)
      .multiplyScalar(dtSeconds / 6),
  );

  position.add(
    k1p
      .addScaledVector(k2p, 2)
      .addScaledVector(k3p, 2)
      .add(k4p)
      .multiplyScalar(dtSeconds / 6),
  );

  return { positionEci: position, velocityEci: velocity };
}

export function createDeploymentState(
  altitudeKm: number,
  speedKmS: number,
  inclinationDeg: number,
  flightPathAngleDeg: number,
): DeploymentState {
  const radius = WGS84_A + altitudeKm;
  const inclination = THREE.MathUtils.degToRad(inclinationDeg);
  const flightPathAngle = THREE.MathUtils.degToRad(flightPathAngleDeg);
  const tangential = new THREE.Vector3(0, Math.cos(inclination), Math.sin(inclination));
  const radial = new THREE.Vector3(1, 0, 0);
  const velocity = tangential.multiplyScalar(Math.cos(flightPathAngle)).addScaledVector(radial, Math.sin(flightPathAngle));

  return {
    positionEci: new THREE.Vector3(radius, 0, 0),
    velocityEci: velocity.normalize().multiplyScalar(speedKmS),
  };
}

export function circularVelocityAtAltitude(altitudeKm: number): number {
  return Math.sqrt(MU / (WGS84_A + altitudeKm));
}

export function toScenePosition(vector: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(vector.x, vector.z, -vector.y).multiplyScalar(SCALE);
}

export function formatLatitude(latitudeDeg: number): string {
  const hemisphere = latitudeDeg >= 0 ? 'N' : 'S';
  return `${Math.abs(latitudeDeg).toFixed(3)}° ${hemisphere}`;
}

export function formatLongitude(longitudeDeg: number): string {
  const wrapped = THREE.MathUtils.euclideanModulo(longitudeDeg + 180, 360) - 180;
  const hemisphere = wrapped >= 0 ? 'E' : 'W';
  return `${Math.abs(wrapped).toFixed(3)}° ${hemisphere}`;
}

export function formatDistance(distanceKm: number | null, unitSystem: UnitSystem, digits = 2): string {
  if (distanceKm === null || !Number.isFinite(distanceKm)) {
    return '--';
  }

  const value = unitSystem === 'metric' ? distanceKm : distanceKm * MI_PER_KM;
  const unit = unitSystem === 'metric' ? 'km' : 'mi';
  return `${value.toFixed(digits)} ${unit}`;
}

export function formatSpeed(speedKmS: number, unitSystem: UnitSystem): string {
  const value = unitSystem === 'metric' ? speedKmS : speedKmS * MI_PER_KM;
  const unit = unitSystem === 'metric' ? 'km/s' : 'mi/s';
  return `${value.toFixed(4)} ${unit}`;
}

export function formatPeriod(periodMinutes: number | null): string {
  if (periodMinutes === null || !Number.isFinite(periodMinutes)) {
    return '--';
  }

  if (periodMinutes >= 180) {
    return `${(periodMinutes / 60).toFixed(2)} h`;
  }

  return `${periodMinutes.toFixed(2)} min`;
}

export function formatDateUtc(date: Date): string {
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function acceleration(position: THREE.Vector3, velocity: THREE.Vector3, useDrag: boolean): THREE.Vector3 {
  const radiusSquared = position.lengthSq();
  const radius = Math.sqrt(radiusSquared);
  const zSquared = position.z * position.z;
  const factor = (1.5 * J2 * MU * WGS84_A * WGS84_A) / Math.pow(radius, 5);
  const zRatio = (5 * zSquared) / radiusSquared;
  const gravity = position.clone().multiplyScalar(-MU / (radiusSquared * radius));

  gravity.x += factor * position.x * (zRatio - 1);
  gravity.y += factor * position.y * (zRatio - 1);
  gravity.z += factor * position.z * (zRatio - 3);

  if (!useDrag) {
    return gravity;
  }

  const altitudeKm = radius - WGS84_A;
  if (altitudeKm <= 0 || altitudeKm > 1000) {
    return gravity;
  }

  const atmosphereVelocity = new THREE.Vector3(0, 0, EARTH_ROTATION_RAD_S).cross(position);
  const relativeVelocity = velocity.clone().sub(atmosphereVelocity);
  const speedMetersPerSecond = relativeVelocity.length() * 1000;
  const density = RHO_0 * Math.exp(-altitudeKm / H_SCALE_KM);
  const dragMetersPerSecondSquared =
    0.5 * density * speedMetersPerSecond * speedMetersPerSecond * DEFAULT_CD * DEFAULT_AREA_TO_MASS;
  const dragKilometersPerSecondSquared = dragMetersPerSecondSquared / 1000;

  return gravity.add(relativeVelocity.normalize().multiplyScalar(-dragKilometersPerSecondSquared));
}

function computeEccentricityVector(position: THREE.Vector3, velocity: THREE.Vector3): THREE.Vector3 {
  const radius = position.length();
  const speedSquared = velocity.lengthSq();
  const radialVelocity = position.dot(velocity);

  return position
    .clone()
    .multiplyScalar(speedSquared - MU / radius)
    .sub(velocity.clone().multiplyScalar(radialVelocity))
    .multiplyScalar(1 / MU);
}

function toSatelliteVector(vector: THREE.Vector3): satellite.EciVec3<number> {
  return { x: vector.x, y: vector.y, z: vector.z };
}
