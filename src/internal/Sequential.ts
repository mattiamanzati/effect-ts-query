import * as HM from "@effect-ts/core/Persistent/HashMap";
import * as A from "@effect-ts/core/Common/Array";
import * as O from "@effect-ts/core/Common/Option";
import { DataSource } from "src/DataSource";
import { BlockedRequest } from "./BlockedRequest";

/**
 * A `Sequential[R]` maintains a mapping from data sources to batches of
 * requests from those data sources that must be executed sequentially.
 */
export class Sequential<R> {
  readonly _R!: (r: R) => void;
  constructor(
    public readonly map: HM.HashMap<
      DataSource<unknown, unknown>,
      A.Array<A.Array<BlockedRequest<unknown>>>
    >
  ) {}
}

/**
 * Combines this collection of batches of requests that must be executed
 * sequentially with that collection of batches of requests that must be
 * executed sequentially to return a new collection of batches of requests
 * that must be executed sequentially.
 */
export function combine<R1>(that: Sequential<R1>) {
  return <R>(self: Sequential<R>): Sequential<R & R1> =>
    new Sequential(
      HM.reduceWithIndex_(that.map, self.map, (map, k, v) =>
        HM.set_(
          map,
          k,
          O.fold_(
            HM.get_(map, k),
            () => A.empty,
            (_) => A.concat_(_, v)
          )
        )
      )
    );
}

/**
 * Returns whether this collection of batches of requests is empty.
 */
export function isEmpty<R>(self: Sequential<R>) {
  return HM.isEmpty(self.map);
}

/**
 * Returns a collection of the data sources that the batches of requests in
 * this collection are from.
 */
export function keys<R>(self: Sequential<R>): Iterable<DataSource<R, unknown>> {
  return HM.keys(self.map);
}

/**
 * Converts this collection of batches requests that must be executed
 * sequentially to an `Iterable` containing mappings from data sources to
 * batches of requests from those data sources.
 */
export function toIterable<R>(
  self: Sequential<R>
): Iterable<
  readonly [DataSource<R, unknown>, A.Array<A.Array<BlockedRequest<R>>>]
> {
  return self.map as any;
}