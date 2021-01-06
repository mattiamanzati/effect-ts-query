export abstract class Request<E, A> {
  abstract readonly _tag: string;
  readonly _E!: () => E;
  readonly _A!: () => A;
}
