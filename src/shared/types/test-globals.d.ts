declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function expect(actual: any): any;

declare namespace GeoJSON {
  type Feature<G = any, P = any> = any;
  type FeatureCollection<G = any, P = any> = any;
  type Geometry = any;
  type Point = any;
  type MultiPoint = any;
  type LineString = any;
  type MultiLineString = any;
  type Polygon = any;
  type MultiPolygon = any;
  type GeoJsonProperties = any;
}
