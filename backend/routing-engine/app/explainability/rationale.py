from typing import List, Dict, Any, Optional


def generate_structured_rationale(
    paths: List[Dict[str, Any]],
    constraints_applied: List[Dict[str, Any]],
    vehicle_profile: str,
    urgency_profile: str,
    confidence: float,
) -> str:
    """
    Builds a deterministic, fact-grounded explanation for emergency operators.
    Must never hallucinate or use unconstrained generative prose.
    """
    if not paths:
        reasons = [c["reason"] for c in constraints_applied]
        constraint_summary = "; ".join(reasons[:3]) if reasons else "No connected topological path exists"
        return (
            f"NO FEASIBLE ROUTE AVAILABLE for {vehicle_profile.upper()} under {urgency_profile.upper()} urgency profile. "
            f"All corridors were eliminated by hard constraints: {constraint_summary}. "
            f"Immediate human operator intervention or air logistics escalation is required."
        )

    best = paths[0]
    num_nodes = len(best["nodes"])
    total_cost = best["total_cost"]
    eta = best["estimated_travel_minutes"]
    safety = best["composite_safety_score"]
    bottleneck = best.get("bottleneck")

    if safety < 0.50:
        sentences = [
            f"WARNING - HIGH RISK ROUTE (Rank 1): No fully safe corridor exists. This route spans {num_nodes} nodes with an estimated transit time of {eta:.1f} minutes "
            f"and composite path safety of only {safety:.0%} (Cost metric: {total_cost:.2f}). Exercise extreme caution."
        ]
    elif safety < 0.80:
        sentences = [
            f"CAUTION ADVISED (Rank 1): Route spans {num_nodes} nodes with an estimated transit time of {eta:.1f} minutes "
            f"and composite path safety score of {safety:.0%} (Yellow band; Cost metric: {total_cost:.2f})."
        ]
    else:
        sentences = [
            f"Recommended primary safest route (Rank 1) spans {num_nodes} nodes with an estimated transit time of {eta:.1f} minutes "
            f"and composite path safety score of {safety:.0%} (Green band; Cost metric: {total_cost:.2f})."
        ]

    if constraints_applied:
        sentences.append(
            f"{len(constraints_applied)} road segment(s) were pruned under vehicle/operational constraints "
            f"(e.g., {constraints_applied[0]['reason']})."
        )

    if bottleneck:
        sentences.append(
            f"Identified critical bottleneck on segment '{bottleneck['edge_id']}' ({bottleneck.get('from_node')} -> {bottleneck.get('to_node')}): "
            f"{bottleneck['reason']} with local safety at {bottleneck['safety_score']:.0%}."
        )

    if len(paths) > 1:
        alt = paths[1]
        delta_time = alt["estimated_travel_minutes"] - eta
        time_desc = f"+{delta_time:.1f} min" if delta_time >= 0 else f"{delta_time:.1f} min"
        sentences.append(
            f"Alternative route (Rank 2) provides secondary redundancy via {len(alt['nodes'])} nodes "
            f"({time_desc}, safety: {alt['composite_safety_score']:.0%}). Overall routing confidence: {confidence:.0%}."
        )
    else:
        sentences.append("No independent secondary alternatives currently meet vehicle passability criteria.")

    sentences.append(
        "Decision-support estimate: Ground conditions remain subject to field verification by operational dispatch."
    )

    return " ".join(sentences)

