// Implements the subset of window.claude.use(...) the app needs, on top of Supabase.
(function () {
  var cfg = window.APP_CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var session = null;
  var profile = null;
  var signedIn;
  var ready = new Promise(function (res) { signedIn = res; });

  window.blobUrl = function (id) {
    return cfg.SUPABASE_URL + "/storage/v1/object/public/photos/" + encodeURIComponent(id);
  };

  // ---------- login ----------
  function showLogin() {
    var el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;z-index:1000;background:#F3F4EE;display:flex;align-items:center;justify-content:center;padding:16px;font-family:'Times New Roman',Times,serif;color:#16231B";
    el.innerHTML =
      '<form style="background:#fff;border:1px solid #DBDACB;border-radius:14px;padding:24px;width:100%;max-width:340px;display:flex;flex-direction:column;gap:10px">' +
      '<img src="assets/logo.png" alt="Le Charcutier" style="height:44px;align-self:center;border-radius:6px;margin-bottom:6px">' +
      '<input name="email" type="email" placeholder="Email" required autocomplete="username" style="padding:10px;border:1px solid #DBDACB;border-radius:6px;font:inherit">' +
      '<input name="password" type="password" placeholder="Password" required autocomplete="current-password" style="padding:10px;border:1px solid #DBDACB;border-radius:6px;font:inherit">' +
      '<button style="padding:10px;border:0;border-radius:6px;background:#2E6B4E;color:#fff;font:inherit;font-weight:700;cursor:pointer">Sign in</button>' +
      '<div class="err" style="color:#BD4128;font-size:13px;min-height:16px"></div></form>';
    document.body.appendChild(el);
    el.querySelector("form").addEventListener("submit", async function (e) {
      e.preventDefault();
      var f = e.target;
      var r = await sb.auth.signInWithPassword({ email: f.email.value, password: f.password.value });
      if (r.error) { f.querySelector(".err").textContent = r.error.message; return; }
      session = r.data.session; el.remove(); await finish();
    });
  }
  async function finish() {
    var r = await sb.from("profiles").select("*").eq("id", session.user.id).single();
    profile = r.data || { id: session.user.id, email: session.user.email, is_admin: false };
    var out = document.createElement("button");
    out.textContent = "Sign out";
    out.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:50;font:12px 'Times New Roman',serif;padding:4px 10px;border:1px solid #DBDACB;border-radius:999px;background:#fff;cursor:pointer;opacity:.8";
    out.onclick = async function () { await sb.auth.signOut(); location.reload(); };
    document.body.appendChild(out);
    signedIn();
  }
  sb.auth.getSession().then(function (r) {
    session = r.data.session;
    if (session) finish(); else if (document.body) showLogin(); else document.addEventListener("DOMContentLoaded", showLogin);
  });

  // ---------- db ----------
  function split(path) { var i = path.indexOf("/"); return [path.slice(0, i), path.slice(i + 1)]; }
  function snapOf(row, path) {
    var p = split(path);
    return { id: p[1], exists: !!row, data: function () { return row ? row.data : undefined; } };
  }
  function qsOf(rows) {
    return { docs: rows.map(function (r) { return { id: r.id, data: function () { return r.data; } }; }) };
  }
  function docRef(path) {
    var parts = split(path);
    var get = async function () {
      var r = await sb.from("docs").select("*").eq("path", path).maybeSingle();
      if (r.error) throw r.error;
      return snapOf(r.data, path);
    };
    return {
      get: get,
      set: async function (data) {
        var r = await sb.from("docs").upsert({ path: path, collection: parts[0], id: parts[1], data: data });
        if (r.error) throw r.error;
      },
      update: async function (data) {
        var cur = await get();
        if (!cur.exists) throw new Error("No document to update: " + path);
        var r = await sb.from("docs").update({ data: Object.assign({}, cur.data(), data) }).eq("path", path);
        if (r.error) throw r.error;
      },
      delete: async function () {
        var r = await sb.from("docs").delete().eq("path", path);
        if (r.error) throw r.error;
      },
      acquire: async function () { return { acquired: true }; },
      onSnapshot: function (cb, errCb) {
        var push = function () { get().then(cb, errCb); };
        push();
        var ch = sb.channel("doc-" + path + "-" + Math.random().toString(36).slice(2))
          .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "path=eq." + path }, push).subscribe();
        return function () { sb.removeChannel(ch); };
      }
    };
  }
  function collectionRef(name) {
    var list = async function () {
      var r = await sb.from("docs").select("*").eq("collection", name);
      if (r.error) throw r.error;
      return qsOf(r.data || []);
    };
    return {
      doc: function (id) { return docRef(name + "/" + id); },
      get: list,
      add: async function (data) {
        var id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
        await docRef(name + "/" + id).set(data);
        return docRef(name + "/" + id);
      },
      onSnapshot: function (cb, errCb) {
        var push = function () { list().then(cb, errCb); };
        push();
        var ch = sb.channel("col-" + name + "-" + Math.random().toString(36).slice(2))
          .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "collection=eq." + name }, push).subscribe();
        return function () { sb.removeChannel(ch); };
      }
    };
  }

  var apis = {
    db: function () { return { doc: docRef, collection: collectionRef }; },
    assets: function () {
      return {
        upload: async function (file) {
          var id = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
          var r = await sb.storage.from("photos").upload(id, file, { contentType: file.type });
          if (r.error) throw r.error;
          return { id: id };
        },
        delete: async function (id) { await sb.storage.from("photos").remove([id]); }
      };
    },
    user: function () {
      return {
        me: async function () { return { id: profile.id, isOwner: !!profile.is_admin, canEdit: !!profile.is_admin }; },
        profiles: async function (ids) {
          var r = await sb.from("profiles").select("id,email").in("id", ids);
          var out = {};
          (r.data || []).forEach(function (p) { out[p.id] = { name: p.email }; });
          return out;
        }
      };
    },
    downloads: function () {
      return {
        save: async function (o) {
          var url = URL.createObjectURL(o.data);
          var a = document.createElement("a");
          a.href = url; a.download = o.filename; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
          return { status: "saved" };
        }
      };
    },
    mcp: function () { return null; } // Google Drive sync isn't available outside Claude
  };

  window.claude = {
    use: async function (name) {
      await ready;
      return apis[name] ? apis[name]() : null;
    }
  };
})();
