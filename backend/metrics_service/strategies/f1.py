import re
from collections import Counter
from typing import Iterable, List, Tuple

from .base import MetricStrategy, Sample, StrategyResult
from .registry import register_strategy


_PUNCT_RE = re.compile(r"[^\w\s']+", flags=re.UNICODE)
_WS_RE = re.compile(r"\s+", flags=re.UNICODE)


def _tokenize(text: str) -> List[str]:
    if not text:
        return []
    text = text.lower()
    text = _PUNCT_RE.sub(" ", text)
    text = _WS_RE.sub(" ", text).strip()
    return text.split(" ") if text else []


def _bag_overlap(reference: List[str], hypothesis: List[str]) -> int:
    return sum((Counter(reference) & Counter(hypothesis)).values())


def _pair_prf(reference: str, hypothesis: str) -> Tuple[float, float, float]:
    ref_tokens = _tokenize(reference)
    hyp_tokens = _tokenize(hypothesis)

    if not ref_tokens and not hyp_tokens:
        return 1.0, 1.0, 1.0
    if not ref_tokens or not hyp_tokens:
        return 0.0, 0.0, 0.0

    overlap = _bag_overlap(ref_tokens, hyp_tokens)
    precision = overlap / len(hyp_tokens)
    recall = overlap / len(ref_tokens)
    if precision + recall == 0:
        return 0.0, 0.0, 0.0
    f1 = 2 * precision * recall / (precision + recall)
    return precision, recall, f1


@register_strategy
class TokenF1(MetricStrategy):
    name = "f1"

    def compute(self, samples: Iterable[Sample]) -> StrategyResult:
        precisions: List[float] = []
        recalls: List[float] = []
        f1s: List[float] = []

        for sample in samples:
            p, r, f = _pair_prf(sample.reference, sample.hypothesis)
            precisions.append(p)
            recalls.append(r)
            f1s.append(f)

        n = len(f1s)
        if n == 0:
            return StrategyResult(
                strategy_name=self.name, value=0.0, breakdown={}, sample_count=0
            )

        return StrategyResult(
            strategy_name=self.name,
            value=sum(f1s) / n,
            breakdown={
                "precision": sum(precisions) / n,
                "recall": sum(recalls) / n,
            },
            sample_count=n,
        )
