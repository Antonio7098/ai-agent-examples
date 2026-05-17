# Repo Analysis: temporal

## Multi-Agent Coordination Analysis

### Repo Info

| Field | Value |
|-------|-------|
| Name | temporal |
| Path | `/home/antonioborgerees/coding/ai-agent-examples/repos/temporal` |
| Language / Stack | Go |
| Analyzed | 2026-05-17 |

## Summary

Temporal is a workflow orchestration engine that manages task routing between workers and workflow executions. It does not implement multi-agent coordination in the sense of autonomous agents negotiating or collaborating. Instead, it provides a **planner-worker model** where a central matching service routes tasks to registered workers based on task queues, and a **hierarchical coordination** pattern through task queue partitions with parent-child forwarding. Workers are stateless and receive tasks via long-poll; the server coordinates all task routing decisions.

## Rating

**6/10** — Basic agent routing with structured task queue partitions, forwarding, and version-based routing. No negotiation, consensus, or delegation between agents. Coordination is centralized in the matching service.

## Evidence Collected

| Area | Evidence | File:Line |
|------|----------|-----------|
| Worker registration interface | `WorkerComponent` interface for registering workflows/activities | `service/worker/common/interface.go:12-25` |
| Worker allocation via consistent hashing | `getLocallyDesiredWorkers` uses `serviceResolver.LookupN` for consistent hashing | `service/worker/pernamespaceworker.go:268-281` |
| Task routing via partitions | `taskQueuePartitionManagerImpl` manages partitions with parent-child relationships | `service/matching/task_queue_partition_manager.go:66-102` |
| Sync match with channels | `TaskMatcher` uses Go channels (`taskC`, `queryTaskC`) for producer-consumer sync | `service/matching/matcher.go:24-46` |
| Forwarder for cross-partition tasks | `Forwarder` forwards tasks to parent partition with rate limiting | `service/matching/forwarder.go:22-47` |
| ForwardTask method | `ForwardTask` routes workflow/activity tasks to parent partition | `service/matching/forwarder.go:96-161` |
| ForwardPoll method | `ForwardPoll` routes poll requests to parent partition | `service/matching/forwarder.go:230-317` |
| Task queue key partitioning | `tqid.NormalPartition` used for partition routing | `service/matching/forwarder.go:74` |
| Matching engine state | `matchingEngineImpl.partitions` map for partition management | `service/matching/matching_engine.go:158` |
| Membership-based service resolver | `ServiceResolver.Lookup(key string)` for consistent hashing | `common/membership/interfaces.go:67-91` |
| Version-aware routing | `VersionMembershipAndReactivationStatusCache` for build ID membership checking | `common/worker_versioning/version_membership_cache.go:23-42` |
| Worker poller tracking | `workerPollerTracker` tracks pollers by worker instance key | `service/matching/matching_engine.go:128-131` |
| Shard-based workflow ownership | `ContextImpl` with `shardID` for workflow execution partitioning | `service/history/shard/context_impl.go:80-99` |
| Nexus task dispatch | `DispatchNexusTask` routes nexus tasks through sync match path | `service/matching/task_queue_partition_manager.go:829-882` |

## Answers to Protocol Questions

### 1. How do agents discover each other?

Workers are not autonomous agents — they are SDK workers that register with the server via polling. Discovery is implicit through task queue names:

- Workers call `Worker.poll()` on a specific task queue, which registers them as available pollers
- The `PerNamespaceWorkerManager` uses **consistent hashing** via `serviceResolver.LookupN(key, n)` to determine how many workers to run per namespace (`service/worker/pernamespaceworker.go:268-281`)
- Task queue partitions are loaded lazily when tasks arrive or polls are made
- No explicit agent registry; workers self-register through polling

### 2. What communication patterns are used?

- **Sync match via Go channels**: `TaskMatcher` uses `taskC chan *internalTask` and `queryTaskC chan *internalTask` for in-process coordination (`service/matching/matcher.go:28-33`)
- **gRPC for cross-node communication**: `Forwarder` uses `matchingservice.MatchingServiceClient` to forward tasks/poll requests to parent partitions (`service/matching/forwarder.go:28`)
- **Channel-based coordination**: `offerOrTimeout` and `syncOfferTask` block on channels or forwarding (`service/matching/matcher.go:173-188, 190-250`)
- No message queues; coordination is through RPC and shared database

### 3. How is shared state coordinated?

- **Database-backed task queue**: Tasks are persisted to database and read by matching nodes (`service/matching/task_queue_partition_manager.go:477`)
- **SyncMap for query/nexus results**: `matchingEngineImpl.queryResults` and `nexusResults` use `collection.SyncMap` for in-flight query tracking (`service/matching/matching_engine.go:167, 171`)
- **Membership-based consistent hashing**: `serviceResolver.LookupN` distributes worker allocation across cluster nodes (`service/worker/pernamespaceworker.go:270`)
- **Shard-based workflow execution**: Each workflow execution is owned by a specific shard (`service/history/shard/context_impl.go:80-99`)
- No distributed consensus; shard ownership provides implicit coordination

### 4. How are conflicts between agents resolved?

Temporal does not support multi-agent conflicts because workers are not autonomous:

- **Version-based routing**: Workers with different build IDs are routed to different physical task queues (`service/matching/task_queue_partition_manager.go:532-598`)
- **Redirect rules**: `findTerminalBuildId` redirects tasks to the current compatible version (`service/matching/task_queue_partition_manager.go:591-596`)
- **Sticky worker timeout**: If a sticky worker doesn't respond within 10s, tasks fall back to non-sticky queue (`service/matching/matching_engine.go:71-73`)
- **Task forwarding**: Tasks are forwarded to parent partition if no local poller is available (`service/matching/matcher.go:144-170`)
- No voting, negotiation, or consensus — the server makes all routing decisions

### 5. Is coordination centralized or distributed?

**Centralized** — the matching service coordinates all task routing:

- All task queue partition routing decisions are made by the matching service (`service/matching/matching_engine.go:567-653`)
- Workers do not coordinate with each other directly; they poll the server
- Forwarder forwards to parent partition but parent makes final routing decision
- Membership changes trigger re-evaluation of task queue ownership (`service/matching/matching_engine.go:366-421`)

### 6. How is coordination overhead managed?

- **Rate limiting on forwarder**: `Forwarder` uses token bucket rate limiting (`quotas.DynamicRateLimiterImpl`) to limit outstanding forwarded tasks (`service/matching/forwarder.go:46, 86-88`)
- **Backlog-based throttling**: `isBacklogNegligible()` check stops forwarding when significant backlog exists (`service/matching/matcher.go:308-327`)
- **Token channels for forwarder calls**: `addReqToken` and `pollReqToken` atomic.Value channels limit concurrent forward calls (`service/matching/forwarder.go:36-37`)
- **TTL-based worker cache**: `shutdownWorkersCacheTTL = 30s` evicts stale worker entries (`service/matching/matching_engine.go:81`)

### 7. How are tasks routed to the right agent?

- **Task queue name**: Primary routing key is the task queue name
- **Build ID versioning**: Workers with different build IDs poll different physical queues (`service/matching/task_queue_partition_manager.go:574-598`)
- **Partition-based routing**: Task queue partitions form a tree; child partitions forward to parent (`service/matching/task_queue_partition_manager.go:56-66`)
- **Deployment versioning**: Workers specify `WorkerVersionCapabilities` and `DeploymentOptions` which determine routing (`service/matching/matching_engine.go:689-696`)
- **Sticky queues**: Workflows can pin to a specific sticky task queue for the remainder of a session
- Routing is determined at poll time based on worker capabilities and versioning data

### 8. Can agents delegate to other agents?

**No** — workers cannot delegate tasks to other workers:

- Workers receive tasks and execute them; they do not spawn sub-agents
- Activities and workflows are the unit of delegation, not agents
- Workflows can invoke child workflows, but this is structured callback, not dynamic delegation
- Nexus endpoints provide an HTTP-like integration point but do not enable agent-to-agent delegation

## Architectural Decisions

| Decision | Rationale | Tradeoff |
|----------|-----------|----------|
| Central matching service | Single source of truth for task routing | Single point of contention; requires all workers to poll |
| Task queue partitions with forwarding | Allows horizontal scaling of task queue capacity | Adds latency via cross-node forwarding |
| Sync match via Go channels | Efficient in-process producer-consumer matching | Only works within a single matching node |
| Consistent hashing for worker allocation | Distributes workers evenly across cluster | Requires membership subsystem; may cause brief unavailability on membership changes |
| Shard-based workflow ownership | Prevents split-brain for workflow state | Limits workflow-level parallelism to number of shards |
| Version-based routing via build IDs | Enables zero-downtime deployments | Requires version data to be propagated; more complex routing logic |

## Notable Patterns

1. **Sync Match Pattern**: Tasks are first tried against waiting pollers via Go channel (`taskC <- task`), then spooled to DB if no match, then potentially forwarded to parent partition
2. **Partition Tree**: Task queues are partitioned into a tree structure; root partition coordinates with child partitions via forwarder
3. **Lazy Partition Loading**: Partitions are loaded on-demand when tasks or polls arrive, reducing memory footprint
4. **Membership-Driven Scaling**: `PerNamespaceWorkerManager` uses consistent hashing to determine per-node worker counts
5. **Rate-Limited Forwarding**: The forwarder uses token bucket rate limiting to prevent cascade overload

## Tradeoffs

- **Centralized coordination limits autonomy**: Workers are passive task consumers; no dynamic agent-to-agent coordination
- **Forwarding adds latency**: Cross-partition forwarding introduces ~1-2 round trips for tasks in child partitions
- **Membership dependency**: Worker allocation relies on consistent membership; membership changes trigger worker redistribution
- **No native negotiation**: The "when two agents disagree, who wins?" question is inapplicable — the server decides all routing
- **Sticky queues are a bottleneck**: Pinning workflows to sticky workers can cause head-of-line blocking if the sticky worker is slow

## Failure Modes / Edge Cases

| Failure Mode | Mechanism | Mitigation |
|-------------|----------|------------|
| Worker shutdown during task | `CancelOutstandingWorkerPolls` rejects polls from shutdown workers via `shutdownWorkers` cache | `matchingEngineImpl.go:183, 1202-1208` |
| No recent poller | Tasks time out with `errNoRecentPoller` if no poller seen recently | Metrics emitted; `noRecentPollerTasksPerTaskQueueCounter` |
| Forwarder rate limited | `errForwarderSlowDown` causes exponential backoff on forwarding | `forwarder.go:58, 232-238` |
| Sticky worker unavailable | Falls back to non-sticky queue after 10s sticky poller unavailable window | `matching_engine.go:71-73, 586` |
| Partition ownership lost | Membership change triggers unloading of partitions no longer owned | `watchMembership` goroutine with `MembershipUnloadDelay` |
| Namespace handover | Tasks rejected during namespace handover state | `common.ErrNamespaceHandover` check in error handling |
| Backlog neglect threshold | Sync match disabled when backlog age exceeds threshold | `isBacklogNegligible()` check at `matcher.go:110-117` |

## Future Considerations

- **No current support for agent delegation protocols**: Workers are SDK-managed and cannot dynamically delegate to other workers
- **Chasm library for state machines**: `chasm/` directory contains a library for Coordinated Heterogeneous Application State Machines, suggesting potential future multi-agent coordination primitives
- **Nexus as external agent integration**: Nexus provides HTTP-like endpoints for external services but does not enable peer-to-peer agent coordination

## Questions / Gaps

| Question | Search Boundary | Finding |
|----------|----------------|--------|
| How do agents negotiate task assignment? | No negotiation protocol found | Server-centric routing only; workers do not negotiate |
| Is there a blackboard or shared knowledge base? | No shared memory subsystem found | Task state is in DB; no in-memory blackboard pattern |
| Can workers spawn sub-agents? | SDK workers are passive | No evidence of dynamic agent spawning; only workflow/activity execution |
| How is consensus reached on shared state? | No consensus protocol found | Shard ownership provides implicit consensus via leader lock |
| Is there a swarm or debate pattern? | No such pattern found | Not applicable to Temporal's architecture |
| Can agents delegate to other agents? | No delegation protocol found | Only hierarchical task routing via forwarder; no peer delegation |