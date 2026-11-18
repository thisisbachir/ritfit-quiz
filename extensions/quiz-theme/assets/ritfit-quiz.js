/* RitFit product quiz — storefront widget. No dependencies. */
(function () {
  "use strict";
  if (window.__ritfitQuizLoaded) return;
  window.__ritfitQuizLoaded = true;

  var API = "/apps/ritfit-quiz";
  var RESPONSE_ATTRIBUTE = "_quiz_response_id"; // must match app/routes/webhooks.orders.create.tsx
  var root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";

  /* ---------- helpers ---------- */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.indexOf("on") === 0) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function visitorId() {
    var key = "rq_visitor";
    try {
      var id = localStorage.getItem(key);
      if (!id) {
        id = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        localStorage.setItem(key, id);
      }
      return id;
    } catch (e) {
      return "anonymous";
    }
  }

  function money(amount, currency) {
    try {
      return new Intl.NumberFormat(document.documentElement.lang || "en-US", {
        style: "currency",
        currency: currency || "USD",
      }).format(amount);
    } catch (e) {
      return "$" + Number(amount).toFixed(2);
    }
  }

  function previewToken() {
    var m = location.search.match(/[?&]quiz_preview=([a-f0-9]+)/);
    return m ? m[1] : "";
  }

  function api(path, body) {
    var token = previewToken();
    var url = API + path + (token ? (path.indexOf("?") > -1 ? "&" : "?") + "preview=" + token : "");
    var opts = body
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : { headers: { Accept: "application/json" } };
    return fetch(url, opts).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data && data.error ? data.error : "Request failed");
        return data;
      });
    });
  }

  function track(quizId, type, responseId) {
    if (previewToken()) return;
    api("/event", { quizId: quizId, type: type, visitorId: visitorId(), responseId: responseId }).catch(
      function () {},
    );
  }

  /* ---------- quiz ---------- */

  function Quiz(container, quizId, options) {
    this.container = container;
    this.quizId = quizId;
    this.options = options || {};
    this.quiz = null;
    this.step = -1; // -1 = intro, 0..n-1 = questions, n = loading/results
    this.answers = {};
    this.email = "";
    this.consent = false;
    this.started = false;
    this.result = null;
  }

  Quiz.prototype.load = function () {
    var self = this;
    this.container.classList.add("rq-root");
    this.renderMessage("Loading quiz…");
    return api("/quiz/" + encodeURIComponent(this.quizId))
      .then(function (quiz) {
        self.quiz = quiz;
        self.step = quiz.intro && quiz.intro.enabled ? -1 : 0;
        self.render();
        track(self.quizId, "view");
      })
      .catch(function (e) {
        self.renderMessage("This quiz isn't available right now.");
        if (window.console) console.warn("[RitFit Quiz]", e.message);
      });
  };

  Quiz.prototype.renderMessage = function (text) {
    this.container.replaceChildren(el("p", { class: "rq-loading", role: "status", text: text }));
  };

  Quiz.prototype.focusHeading = function () {
    var h = this.container.querySelector(".rq-heading");
    if (h) {
      h.setAttribute("tabindex", "-1");
      h.focus({ preventScroll: true });
      var top = this.container.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) this.container.scrollIntoView({ block: "start" });
    }
  };

  Quiz.prototype.go = function (step) {
    this.step = step;
    this.render();
    this.focusHeading();
  };

  Quiz.prototype.render = function () {
    var q = this.quiz;
    var n = q.questions.length;
    var body;
    if (this.step === -1) body = this.renderIntro();
    else if (this.step < n) body = this.renderQuestion(q.questions[this.step]);
    else body = this.renderResults();

    var card = el("div", { class: "rq-card rq-fade" }, [
      this.step >= 0 && this.step < n ? this.renderProgress() : null,
      body,
    ]);
    this.container.replaceChildren(card);
  };

  Quiz.prototype.renderProgress = function () {
    var n = this.quiz.questions.length;
    var pct = Math.round(((this.step + 1) / n) * 100);
    return el("div", { class: "rq-progress" }, [
      el("div", { class: "rq-progress__meta" }, [
        el("span", { text: "Question " + (this.step + 1) + " of " + n }),
      ]),
      el(
        "div",
        {
          class: "rq-progress__track",
          role: "progressbar",
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-valuenow": String(pct),
          "aria-label": "Quiz progress",
        },
        [el("div", { class: "rq-progress__bar", style: "transform:scaleX(" + pct / 100 + ")" })],
      ),
    ]);
  };

  Quiz.prototype.renderIntro = function () {
    var self = this;
    var intro = this.quiz.intro;
    return el("div", { class: "rq-intro" }, [
      intro.imageUrl ? el("img", { class: "rq-intro__img", src: intro.imageUrl, alt: "", loading: "lazy" }) : null,
      el("h2", { class: "rq-heading rq-h1", text: intro.heading || this.quiz.title }),
      intro.text ? el("p", { class: "rq-text", text: intro.text }) : null,
      el("button", {
        type: "button",
        class: "rq-btn rq-btn--primary",
        text: intro.buttonLabel || "Start Quiz",
        onclick: function () {
          self.go(0);
        },
      }),
    ]);
  };

  Quiz.prototype.markStarted = function () {
    if (!this.started) {
      this.started = true;
      track(this.quizId, "start");
    }
  };

  Quiz.prototype.renderNav = function (canContinue, nextLabel, onNext) {
    var self = this;
    var first = this.step === 0 && !(this.quiz.intro && this.quiz.intro.enabled);
    return el("div", { class: "rq-nav" }, [
      first
        ? el("span")
        : el("button", {
            type: "button",
            class: "rq-btn rq-btn--ghost",
            text: "Back",
            onclick: function () {
              self.go(self.step - 1);
            },
          }),
      onNext
        ? el("button", {
            type: "button",
            class: "rq-btn rq-btn--primary",
            text: nextLabel,
            disabled: !canContinue,
            "aria-disabled": canContinue ? "false" : "true",
            onclick: onNext,
          })
        : null,
    ]);
  };

  Quiz.prototype.isLast = function () {
    return this.step === this.quiz.questions.length - 1;
  };

  Quiz.prototype.next = function () {
    if (this.isLast()) this.submit();
    else this.go(this.step + 1);
  };

  Quiz.prototype.renderQuestion = function (question) {
    if (question.type === "email") return this.renderEmail(question);
    var self = this;
    var selected = this.answers[question.id] || [];
    var multiple = question.type === "multiple";
    var hasImages = question.answers.some(function (a) {
      return a.imageUrl;
    });

    var options = question.answers.map(function (a) {
      var isOn = selected.indexOf(a.id) > -1;
      return el(
        "button",
        {
          type: "button",
          class: "rq-option" + (isOn ? " is-selected" : "") + (a.imageUrl ? " rq-option--image" : ""),
          role: multiple ? "checkbox" : "radio",
          "aria-checked": isOn ? "true" : "false",
          onclick: function () {
            self.markStarted();
            var cur = (self.answers[question.id] || []).slice();
            if (multiple) {
              var i = cur.indexOf(a.id);
              if (i > -1) cur.splice(i, 1);
              else cur.push(a.id);
              self.answers[question.id] = cur;
              self.render();
              var again = self.container.querySelectorAll(".rq-option")[question.answers.indexOf(a)];
              if (again) again.focus();
            } else {
              self.answers[question.id] = [a.id];
              self.next();
            }
          },
        },
        [
          a.imageUrl ? el("img", { class: "rq-option__img", src: a.imageUrl, alt: "", loading: "lazy" }) : null,
          el("span", { class: "rq-option__body" }, [
            el("span", { class: "rq-option__label", text: a.label }),
            a.description ? el("span", { class: "rq-option__desc", text: a.description }) : null,
          ]),
          el("span", { class: "rq-option__check", "aria-hidden": "true" }),
        ],
      );
    });

    var canContinue = !question.required || selected.length > 0;
    var showNext = multiple || !question.required || (selected.length > 0 && this.isLast());
    return el("fieldset", { class: "rq-question" }, [
      el("legend", { class: "rq-visually-hidden", text: question.title }),
      el("h2", { class: "rq-heading rq-h2", text: question.title }),
      question.subtitle ? el("p", { class: "rq-text", text: question.subtitle }) : null,
      multiple ? el("p", { class: "rq-hint", text: "Select all that apply" }) : null,
      el(
        "div",
        {
          class: "rq-options" + (hasImages ? " rq-options--grid" : ""),
          role: multiple ? "group" : "radiogroup",
          "aria-label": question.title,
        },
        options,
      ),
      this.renderNav(
        canContinue,
        this.isLast() ? "See My Results" : selected.length || question.required ? "Next" : "Skip",
        showNext
          ? function () {
              self.next();
            }
          : null,
      ),
    ]);
  };

  Quiz.prototype.renderEmail = function (question) {
    var self = this;
    var errorId = "rq-email-error-" + this.quizId;
    var input = el("input", {
      type: "email",
      class: "rq-input",
      id: "rq-email-" + this.quizId,
      name: "email",
      autocomplete: "email",
      inputmode: "email",
      placeholder: "you@example.com",
      value: this.email,
      "aria-describedby": errorId,
      required: question.required,
    });
    var error = el("p", { class: "rq-error", id: errorId, role: "alert" });
    var consent = el("input", { type: "checkbox", id: "rq-consent-" + this.quizId, checked: this.consent });

    function submit(e) {
      if (e) e.preventDefault();
      var v = input.value.trim();
      if ((question.required || v) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        error.textContent = "Enter a valid email address.";
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      self.email = v;
      self.consent = consent.checked;
      self.markStarted();
      self.next();
    }

    return el("form", { class: "rq-question", novalidate: true, onsubmit: submit }, [
      el("h2", { class: "rq-heading rq-h2", text: question.title }),
      question.subtitle ? el("p", { class: "rq-text", text: question.subtitle }) : null,
      el("label", { class: "rq-label", for: "rq-email-" + this.quizId, text: "Email" }),
      input,
      error,
      el("label", { class: "rq-consent", for: "rq-consent-" + this.quizId }, [
        consent,
        el("span", { text: question.consentLabel || "Email me offers and training tips from RitFit." }),
      ]),
      el("div", { class: "rq-nav" }, [
        el("button", {
          type: "button",
          class: "rq-btn rq-btn--ghost",
          text: "Back",
          onclick: function () {
            self.go(self.step - 1);
          },
        }),
        el("span", { class: "rq-nav__right" }, [
          question.required
            ? null
            : el("button", {
                type: "button",
                class: "rq-btn rq-btn--link",
                text: "Skip",
                onclick: function () {
                  self.email = "";
                  self.consent = false;
                  self.next();
                },
              }),
          el("button", {
            type: "submit",
            class: "rq-btn rq-btn--primary",
            text: this.isLast() ? "See My Results" : "Next",
          }),
        ]),
      ]),
    ]);
  };

  Quiz.prototype.submit = function () {
    var self = this;
    this.step = this.quiz.questions.length;
    this.result = null;
    this.render();
    api("/submit", {
      quizId: this.quizId,
      visitorId: visitorId(),
      answers: this.answers,
      email: this.email,
      consent: this.consent,
    })
      .then(function (result) {
        self.result = result;
        self.render();
        self.focusHeading();
      })
      .catch(function (e) {
        self.result = { error: e.message || "Something went wrong." };
        self.render();
        self.focusHeading();
      });
  };

  Quiz.prototype.addToCart = function (products, button) {
    var self = this;
    var items = products
      .filter(function (p) {
        return p.variantId;
      })
      .map(function (p) {
        return { id: Number(p.variantId), quantity: 1 };
      });
    if (!items.length) return;
    var original = button.textContent;
    button.disabled = true;
    button.textContent = "Adding…";
    var status = this.container.querySelector(".rq-status");

    fetch(root + "cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ items: items }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error("add failed");
        var attrs = {};
        attrs[RESPONSE_ATTRIBUTE] = self.result.responseId || "";
        // Tag the cart so the order can be attributed to this quiz response.
        return fetch(root + "cart/update.js", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ attributes: attrs }),
        });
      })
      .then(function () {
        track(self.quizId, "add_to_cart", self.result.responseId);
        document.dispatchEvent(new CustomEvent("ritfit-quiz:added-to-cart", { detail: { items: items } }));
        if (self.options.redirectToCart) {
          location.href = root + "cart";
          return;
        }
        button.textContent = "Added";
        if (status) {
          status.replaceChildren(
            document.createTextNode("Added to your cart. "),
            el("a", { href: root + "cart", class: "rq-link", text: "View Cart" }),
          );
        }
      })
      .catch(function () {
        button.disabled = false;
        button.textContent = original;
        if (status) status.textContent = "Sorry, we couldn't add that to your cart. Please try again.";
      });
  };

  Quiz.prototype.renderResults = function () {
    var self = this;
    if (!this.result) {
      return el("div", { class: "rq-results rq-results--loading", role: "status" }, [
        el("span", { class: "rq-spinner", "aria-hidden": "true" }),
        el("h2", { class: "rq-heading rq-h2", text: "Finding your perfect match…" }),
      ]);
    }
    if (this.result.error) {
      return el("div", { class: "rq-results" }, [
        el("h2", { class: "rq-heading rq-h2", text: "Something went wrong" }),
        el("p", { class: "rq-text", text: this.result.error }),
        el("button", {
          type: "button",
          class: "rq-btn rq-btn--primary",
          text: "Try Again",
          onclick: function () {
            self.submit();
          },
        }),
      ]);
    }

    var r = this.quiz.results;
    var products = this.result.products;
    var cards = products.map(function (p, i) {
      var addBtn = el("button", {
        type: "button",
        class: "rq-btn " + (i === 0 ? "rq-btn--primary" : "rq-btn--secondary"),
        text: p.variantId ? "Add to Cart" : "Sold Out",
        disabled: !p.variantId,
        onclick: function (e) {
          self.addToCart([p], e.currentTarget);
        },
      });
      return el("article", { class: "rq-product" + (i === 0 ? " rq-product--best" : "") }, [
        i === 0 ? el("span", { class: "rq-badge", text: "Best match" }) : null,
        el("a", { href: p.url, class: "rq-product__media", tabindex: "-1", "aria-hidden": "true" }, [
          p.imageUrl
            ? el("img", { src: p.imageUrl + (p.imageUrl.indexOf("?") > -1 ? "&" : "?") + "width=600", alt: "", loading: "lazy" })
            : null,
        ]),
        el("div", { class: "rq-product__body" }, [
          el("h3", { class: "rq-product__title" }, [el("a", { href: p.url, text: p.title })]),
          el("p", { class: "rq-price" }, [
            el("span", { class: p.compareAtPrice ? "rq-price__sale" : "", text: money(p.price, p.currency) }),
            p.compareAtPrice
              ? el("s", { class: "rq-price__compare" }, [
                  el("span", { class: "rq-visually-hidden", text: "Regular price " }),
                  money(p.compareAtPrice, p.currency),
                ])
              : null,
          ]),
          p.reasons && p.reasons.length
            ? el("p", { class: "rq-reasons", text: "Matches: " + p.reasons.join(", ") })
            : null,
          el("div", { class: "rq-product__actions" }, [
            addBtn,
            el("a", { href: p.url, class: "rq-link", text: "View Details" }),
          ]),
        ]),
      ]);
    });

    var buyable = products.filter(function (p) {
      return p.variantId;
    });
    var total = buyable.reduce(function (s, p) {
      return s + p.price;
    }, 0);

    return el("div", { class: "rq-results" }, [
      el("h2", { class: "rq-heading rq-h1", text: r.heading || "Your perfect match" }),
      r.text ? el("p", { class: "rq-text", text: r.text }) : null,
      products.length
        ? el("div", { class: "rq-products" }, cards)
        : el("p", { class: "rq-text", text: "We couldn't find an exact match. Browse our full range instead." }),
      r.showAddAll && buyable.length > 1
        ? el("div", { class: "rq-addall" }, [
            el("p", { class: "rq-addall__total" }, [
              "Complete setup: ",
              el("strong", { text: money(total, buyable[0].currency) }),
            ]),
            el("button", {
              type: "button",
              class: "rq-btn rq-btn--primary",
              text: "Add All to Cart",
              onclick: function (e) {
                self.addToCart(buyable, e.currentTarget);
              },
            }),
          ])
        : null,
      el("p", { class: "rq-status", role: "status", "aria-live": "polite" }),
      el("button", {
        type: "button",
        class: "rq-btn rq-btn--link",
        text: "Retake Quiz",
        onclick: function () {
          self.answers = {};
          self.result = null;
          self.go(self.quiz.intro && self.quiz.intro.enabled ? -1 : 0);
        },
      }),
    ]);
  };

  /* ---------- popup ---------- */

  var modal = null;
  var lastFocus = null;

  function openModal(quizId) {
    lastFocus = document.activeElement;
    if (!modal) {
      modal = el("dialog", { class: "rq-modal", "aria-label": "Product quiz" });
      modal.addEventListener("click", function (e) {
        if (e.target === modal) modal.close();
      });
      modal.addEventListener("close", function () {
        document.documentElement.classList.remove("rq-lock");
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      });
      document.body.appendChild(modal);
    }
    var body = el("div", { class: "rq-modal__body" });
    var close = el("button", {
      type: "button",
      class: "rq-modal__close",
      "aria-label": "Close quiz",
      onclick: function () {
        modal.close();
      },
    });
    modal.replaceChildren(close, body);
    document.documentElement.classList.add("rq-lock");
    if (modal.showModal) modal.showModal();
    else modal.setAttribute("open", "");
    new Quiz(body, quizId, {}).load();
  }

  /* ---------- boot ---------- */

  function mountAll() {
    document.querySelectorAll("[data-ritfit-quiz]:not([data-rq-mounted])").forEach(function (node) {
      var id = node.getAttribute("data-ritfit-quiz");
      node.setAttribute("data-rq-mounted", "");
      if (!id) {
        node.replaceChildren(el("p", { class: "rq-loading", text: "Choose a quiz in the theme editor." }));
        return;
      }
      new Quiz(node, id, { redirectToCart: node.getAttribute("data-redirect-to-cart") === "true" }).load();
    });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-ritfit-quiz-open], a[href^='#quiz-']");
    if (!t) return;
    var id = t.getAttribute("data-ritfit-quiz-open") || t.getAttribute("href").slice("#quiz-".length);
    if (!id) return;
    e.preventDefault();
    openModal(id);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountAll);
  else mountAll();
  // Theme editor: re-mount when blocks are added or changed.
  document.addEventListener("shopify:section:load", mountAll);
  document.addEventListener("shopify:block:select", mountAll);

  var hashMatch = location.hash.match(/^#quiz-(.+)$/);
  if (hashMatch) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        openModal(hashMatch[1]);
      });
    } else openModal(hashMatch[1]);
  }

  window.RitFitQuiz = { open: openModal, mount: mountAll };
})();
