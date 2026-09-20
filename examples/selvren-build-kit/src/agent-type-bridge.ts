/**
 * Compile-time bridge between copied public agent types.
 * React stays transport-agnostic: type-only imports, no runtime SDK dependency.
 */
import type {
  AgentAnswer as ReactAgentAnswer,
  AgentCitation as ReactAgentCitation,
  AgentQueryRequest as ReactAgentQueryRequest,
  AgentTransport as ReactAgentTransport,
} from "@selvren/react";
import type {
  AgentAnswer as SdkAgentAnswer,
  AgentCitation as SdkAgentCitation,
  AgentQueryRequest as SdkAgentQueryRequest,
  AgentTransport as SdkAgentTransport,
} from "@selvren/sdk/browser";

type Expect<T extends true> = T;

type Equal<X, Y> = [X] extends [Y] ? ([Y] extends [X] ? true : false) : false;

type Bidirectional<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type SameShape<A, B> = Equal<A, B> extends true
  ? Bidirectional<A, B> extends true ? Equal<keyof A, keyof B> : false
  : false;

export type AgentQueryRequestBridge = Expect<SameShape<SdkAgentQueryRequest, ReactAgentQueryRequest>>;
export type AgentCitationBridge = Expect<SameShape<SdkAgentCitation, ReactAgentCitation>>;
export type AgentAnswerBridge = Expect<SameShape<SdkAgentAnswer, ReactAgentAnswer>>;
export type AgentTransportBridge = Expect<SameShape<SdkAgentTransport, ReactAgentTransport>>;

export type AgentAnswerRevisionChanged = Expect<
  Equal<SdkAgentAnswer["revisionChanged"], ReactAgentAnswer["revisionChanged"]>
>;

export type AgentTransportQuery = Expect<
  SameShape<Parameters<SdkAgentTransport["query"]>, Parameters<ReactAgentTransport["query"]>> extends true
    ? Equal<ReturnType<SdkAgentTransport["query"]>, ReturnType<ReactAgentTransport["query"]>>
    : false
>;
