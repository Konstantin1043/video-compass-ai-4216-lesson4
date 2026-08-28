const MODEL = "gemini-3.5-flash-lite";
const PROMPT_VERSION = "2.1";

function first(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function encoded(value) {
  return encodeURIComponent(String(value));
}

export function analysisCacheKey(videoId, language) {
  return `${videoId}:${language}:${MODEL}:${PROMPT_VERSION}`;
}

export function publicResult(result) {
  if (!result) return null;
  return {
    id: result.id,
    language: result.language,
    video: {
      videoId: result.video_id,
      canonicalUrl: result.canonical_url,
      thumbnailUrl:
        result.thumbnail_url || `https://i.ytimg.com/vi/${result.video_id}/hqdefault.jpg`,
      title: result.video_title || "",
      author: result.video_author || "",
    },
    analysis: result.analysis || null,
    analysisText: result.analysis_text || "",
    transcript: {
      text: result.transcript_text || "",
      segments: Array.isArray(result.transcript_segments) ? result.transcript_segments : [],
      originalCharacters: Number(result.transcript_original_characters || 0),
      sentCharacters: Number(result.transcript_sent_characters || 0),
      shortened: Boolean(result.transcript_shortened),
    },
    model: result.model,
    completedAt: result.completed_at,
  };
}

export function publicJob(job, result) {
  return {
    id: job.id,
    requestId: job.request_id,
    status: result?.status || job.status,
    favorite: Boolean(job.favorite),
    cacheHit: Boolean(job.cache_hit),
    errorCode: result?.error_code || job.error_code || null,
    createdAt: job.created_at,
    completedAt: job.completed_at || result?.completed_at || null,
    result: result?.status === "completed" ? publicResult(result) : null,
  };
}

export function publicHistoryJob(job, result) {
  const item = publicJob(job, result);
  if (!item.result) return item;
  return {
    ...item,
    result: {
      id: item.result.id,
      language: item.result.language,
      video: item.result.video,
      analysis: item.result.analysis
        ? { score: item.result.analysis.score, about: item.result.analysis.about }
        : null,
      completedAt: item.result.completedAt,
    },
  };
}

export function createAnalysisStore(supabase) {
  async function query(path) {
    return supabase.serviceRequest(`rest/v1/${path}`);
  }

  async function findJobByRequest(userId, requestId) {
    return first(await query(
      `analysis_jobs?select=*&user_id=eq.${encoded(userId)}&request_id=eq.${encoded(requestId)}&limit=1`,
    ));
  }

  async function findActiveUserJob(userId, cacheKey) {
    const results = await query(
      `analysis_results?select=id&cache_key=eq.${encoded(cacheKey)}&limit=1`,
    );
    const resultId = first(results)?.id;
    if (!resultId) return null;
    return first(await query(
      `analysis_jobs?select=*&user_id=eq.${encoded(userId)}&result_id=eq.${encoded(resultId)}&deleted_at=is.null&status=in.(queued,transcript_processing,transcript_ready,ai_processing)&order=created_at.desc&limit=1`,
    ));
  }

  async function findResultByCache(cacheKey) {
    return first(await query(
      `analysis_results?select=*&cache_key=eq.${encoded(cacheKey)}&order=completed_at.desc.nullslast,created_at.desc&limit=1`,
    ));
  }

  async function findActiveResultByCache(cacheKey) {
    return first(await query(
      `analysis_results?select=*&cache_key=eq.${encoded(cacheKey)}&status=in.(queued,transcript_processing,transcript_ready,ai_processing)&order=created_at.desc&limit=1`,
    ));
  }

  async function createOrReuseResult(data) {
    try {
      const inserted = await supabase.serviceRequest(
        "rest/v1/analysis_results",
        {
        method: "POST",
        prefer: "return=representation",
        body: data,
        },
      );
      return { result: first(inserted), created: true };
    } catch (error) {
      if (error?.code !== "DATABASE_CONFLICT") throw error;
      return { result: await findActiveResultByCache(data.cache_key), created: false };
    }
  }

  async function createJob(data) {
    const payload = await supabase.serviceRequest("rest/v1/analysis_jobs", {
      method: "POST",
      prefer: "return=representation",
      body: data,
    });
    return first(payload);
  }

  async function getJob(userId, jobId) {
    const job = first(await query(
      `analysis_jobs?select=*&id=eq.${encoded(jobId)}&user_id=eq.${encoded(userId)}&deleted_at=is.null&limit=1`,
    ));
    if (!job) return null;
    const result = first(await query(
      `analysis_results?select=*&id=eq.${encoded(job.result_id)}&limit=1`,
    ));
    return { job, result };
  }

  async function getResult(resultId) {
    return first(await query(
      `analysis_results?select=*&id=eq.${encoded(resultId)}&limit=1`,
    ));
  }

  async function touchResult(resultId) {
    await supabase.serviceRequest(
      `rest/v1/analysis_results?id=eq.${encoded(resultId)}`,
      { method: "PATCH", body: { last_accessed_at: new Date().toISOString() } },
    );
  }

  async function countExternalAnalysesSince(isoDate) {
    const response = await supabase.serviceRpc("count_external_analyses_since", {
      p_since: isoDate,
    });
    return Math.max(0, Number(response || 0));
  }

  async function listHistory(userId) {
    const [favorites, recent] = await Promise.all([
      query(
        `analysis_jobs?select=*&user_id=eq.${encoded(userId)}&deleted_at=is.null&favorite=eq.true&order=created_at.desc&limit=100`,
      ),
      query(
        `analysis_jobs?select=*&user_id=eq.${encoded(userId)}&deleted_at=is.null&favorite=eq.false&order=created_at.desc&limit=30`,
      ),
    ]);
    const jobs = [...favorites, ...recent]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    if (!jobs.length) return [];
    const resultIds = [...new Set(jobs.map((job) => job.result_id))];
    const resultFilter = resultIds.map(encoded).join(",");
    const results = await query(
      `analysis_results?select=*&id=in.(${resultFilter})`,
    );
    const byId = new Map(results.map((result) => [result.id, result]));
    return jobs.map((job) => publicHistoryJob(job, byId.get(job.result_id)));
  }

  async function setFavorite(userId, jobId, favorite) {
    const payload = await supabase.serviceRequest(
      `rest/v1/analysis_jobs?id=eq.${encoded(jobId)}&user_id=eq.${encoded(userId)}&deleted_at=is.null`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: { favorite: Boolean(favorite), updated_at: new Date().toISOString() },
      },
    );
    return first(payload);
  }

  async function deleteJob(userId, jobId) {
    const payload = await supabase.serviceRequest(
      `rest/v1/analysis_jobs?id=eq.${encoded(jobId)}&user_id=eq.${encoded(userId)}&deleted_at=is.null`,
      {
        method: "PATCH",
        prefer: "return=representation",
        body: { deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      },
    );
    return Boolean(first(payload));
  }

  async function findActiveShare(userId, jobId) {
    return first(await query(
      `analysis_shares?select=*&user_id=eq.${encoded(userId)}&job_id=eq.${encoded(jobId)}&revoked_at=is.null&expires_at=gt.${encoded(new Date().toISOString())}&order=created_at.desc&limit=1`,
    ));
  }

  async function createShare(data) {
    return first(await supabase.serviceRequest("rest/v1/analysis_shares", {
      method: "POST",
      prefer: "return=representation",
      body: data,
    }));
  }

  async function revokeShares(userId, jobId) {
    await supabase.serviceRequest(
      `rest/v1/analysis_shares?user_id=eq.${encoded(userId)}&job_id=eq.${encoded(jobId)}&revoked_at=is.null`,
      { method: "PATCH", body: { revoked_at: new Date().toISOString() } },
    );
  }

  async function findShareByHash(tokenHash) {
    const share = first(await query(
      `analysis_shares?select=*&token_hash=eq.${encoded(tokenHash)}&revoked_at=is.null&expires_at=gt.${encoded(new Date().toISOString())}&limit=1`,
    ));
    if (!share) return null;
    const job = first(await query(
      `analysis_jobs?select=*&id=eq.${encoded(share.job_id)}&deleted_at=is.null&limit=1`,
    ));
    if (!job) return null;
    const result = await getResult(job.result_id);
    return result?.status === "completed" ? { share, job, result } : null;
  }

  return {
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    findJobByRequest,
    findActiveUserJob,
    findResultByCache,
    findActiveResultByCache,
    createOrReuseResult,
    createJob,
    getJob,
    getResult,
    touchResult,
    countExternalAnalysesSince,
    listHistory,
    setFavorite,
    deleteJob,
    findActiveShare,
    createShare,
    revokeShares,
    findShareByHash,
  };
}
