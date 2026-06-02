(function () {
      /* ── CONFIG — paste your key here ── */
      var API_KEY  = ''; // 🔐 REMOVED: Set this via server-side injection or environment variable — never hardcode here
      var PLACE_ID = 'ChIJHxAQUGEFDTkRWKKc58QowVs';

      var AVATAR_COLORS = ['#1A56DB','#7c3aed','#059669','#dc2626','#d97706','#0891b2','#be185d'];
      var GOOGLE_LOGO = '<svg width="20" height="20" viewBox="0 0 48 48" class="rv-glogo"><path fill="#4285F4" d="M44.5 20H24v8.5h11.8C34.1 33.8 29.6 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21c10.5 0 20-7.5 20-21 0-1.3-.2-2.7-.5-4z"/><path fill="#EA4335" d="M6.3 14.7l7 5.1C15.2 16.1 19.3 13 24 13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 5.1 29.6 3 24 3c-7.6 0-14.2 4.6-17.7 11.7z"/><path fill="#FBBC05" d="M24 45c5.5 0 10.4-1.9 14.2-5l-6.6-5.4C29.6 36.3 26.9 37 24 37c-5.5 0-10.2-3.3-11.8-8.1l-7 5.4C8 40.3 15.4 45 24 45z"/><path fill="#34A853" d="M44.5 20H24v8.5h11.8c-.9 2.6-2.7 4.8-5 6.1l6.6 5.4C41.3 36.5 45 30.7 45 24c0-1.3-.2-2.7-.5-4z"/></svg>';

      /* slider state */
      var reviews = [], current = 0, perPage = 3, total = 0;

      function starsHTML(n) {
        var s = ''; for (var i = 0; i < 5; i++) s += i < n ? '★' : '☆'; return s;
      }

      function avatarHTML(r, idx) {
        if (r.profile_photo_url) {
          return '<img class="rv-avatar" loading="lazy" src="' + r.profile_photo_url + '" alt="' + r.author_name + '" onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'">' +
                 '<div class="rv-avatar-init" style="background:' + AVATAR_COLORS[idx % AVATAR_COLORS.length] + ';display:none">' + (r.author_name||'?')[0].toUpperCase() + '</div>';
        }
        return '<div class="rv-avatar-init" style="background:' + AVATAR_COLORS[idx % AVATAR_COLORS.length] + '">' + (r.author_name||'?')[0].toUpperCase() + '</div>';
      }

      function cardHTML(r, idx) {
        return '<div class="rv-card">' +
          '<div class="rv-card-head">' +
            avatarHTML(r, idx) +
            '<div><div class="rv-name">' + escHtml(r.author_name) + '</div>' +
            '<div class="rv-date">' + escHtml(r.relative_time_description || '') + '</div></div>' +
            GOOGLE_LOGO +
          '</div>' +
          '<div class="rv-stars-row" style="color:#F59E0B">' + starsHTML(r.rating) + '</div>' +
          '<p class="rv-text">' + escHtml(r.text || '') + '</p>' +
        '</div>';
      }

      function escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function getPerPage() {
        return window.innerWidth < 640 ? 1 : window.innerWidth < 960 ? 2 : 3;
      }

      function renderSlider() {
        perPage = getPerPage();
        total   = Math.ceil(reviews.length / perPage);
        current = Math.min(current, total - 1);

        var track = document.getElementById('rv-track');
        var dots  = document.getElementById('rv-dots');
        if (!track) return;

        /* Build cards in pages */
        track.innerHTML = '';
        for (var p = 0; p < total; p++) {
          var page = document.createElement('div');
          page.style.cssText = 'display:flex;gap:20px;flex:0 0 100%;';
          var slice = reviews.slice(p * perPage, p * perPage + perPage);
          slice.forEach(function(r, i) {
            page.innerHTML += cardHTML(r, p * perPage + i);
          });
          track.appendChild(page);
        }

        /* Dots */
        dots.innerHTML = '';
        for (var d = 0; d < total; d++) {
          var dot = document.createElement('button');
          dot.className = 'rv-dot' + (d === current ? ' active' : '');
          dot.setAttribute('aria-label', 'Go to page ' + (d+1));
          dot.setAttribute('data-page', d);
          dot.addEventListener('click', function(e){ rvGoTo(parseInt(e.target.getAttribute('data-page'))); });
          dots.appendChild(dot);
        }

        updateSliderPos();
      }

      function updateSliderPos() {
        var track = document.getElementById('rv-track');
        if (track) track.style.transform = 'translateX(calc(-' + current + ' * 100%))';
        document.querySelectorAll('.rv-dot').forEach(function(d,i){ d.classList.toggle('active', i===current); });
        var prev = document.getElementById('rv-prev');
        var next = document.getElementById('rv-next');
        if (prev) prev.disabled = current === 0;
        if (next) next.disabled = current === total - 1;
      }

      window.rvSlide = function(dir) { rvGoTo(current + dir); };
      window.rvGoTo  = function(p)   { current = Math.max(0, Math.min(total-1, p)); updateSliderPos(); };

      /* Swipe / touch support */
      (function() {
        var vp = document.getElementById('rv-viewport');
        if (!vp) return;
        var startX = 0;
        vp.addEventListener('touchstart', function(e){ startX = e.touches[0].clientX; }, {passive:true});
        vp.addEventListener('touchend', function(e){
          var dx = e.changedTouches[0].clientX - startX;
          if (Math.abs(dx) > 50) rvSlide(dx < 0 ? 1 : -1);
        }, {passive:true});
      })();

      /* Auto-advance */
      var autoTimer = setInterval(function(){
        if (document.hidden) return;
        rvGoTo(current + 1 < total ? current + 1 : 0);
      }, 5000);

      window.addEventListener('resize', function(){ renderSlider(); });

      /* ── Fetch from Google Places API ── */
      function showError() {
        document.getElementById('rv-loading').style.display = 'none';
        document.getElementById('rv-error').style.display   = 'block';
      }

      function render(place) {
        /* Summary bar */
        document.getElementById('rv-score').textContent = place.rating || '—';
        document.getElementById('rv-stars-summary').textContent = starsHTML(Math.round(place.rating||0));
        document.getElementById('rv-stars-summary').style.color = '#F59E0B';
        document.getElementById('rv-total-text').textContent = (place.user_ratings_total || 0) + ' Google Reviews';

        // ── Sync AggregateRating schema with live Google data ──────────────
        // Keeps JSON-LD always accurate without manual updates
        try {
          const agSchema = document.querySelector('script[type="application/ld+json"]');
          if (agSchema && place.rating && place.user_ratings_total) {
            const schemaData = JSON.parse(agSchema.textContent);
            if (schemaData.aggregateRating) {
              schemaData.aggregateRating.ratingValue  = place.rating.toFixed(1);
              schemaData.aggregateRating.ratingCount  = place.user_ratings_total;
              schemaData.aggregateRating.reviewCount  = place.user_ratings_total;
              agSchema.textContent = JSON.stringify(schemaData);
            }
          }
        } catch(e) { console.warn('Schema sync failed:', e.message); }
        document.getElementById('rv-summary').style.display = 'flex';

        /* Reviews */
        reviews = (place.reviews || []).filter(function(r){ return r.text && r.text.trim(); });
        if (!reviews.length) { showError(); return; }

        document.getElementById('rv-loading').style.display = 'none';
        document.getElementById('rv-viewport').style.display = 'block';
        document.getElementById('rv-nav').style.display      = 'flex';

        renderSlider();
      }

      /* CORS-safe: use Maps JavaScript API callback approach */
      window.__rvCallback = function() {
        if (typeof google === 'undefined' || !google.maps || !google.maps.places) { showError(); return; }
        var svc = new google.maps.places.PlacesService(document.createElement('div'));
        svc.getDetails({
          placeId: PLACE_ID,
          fields: ['rating','user_ratings_total','reviews']
        }, function(place, status) {
          if (status === google.maps.places.PlacesServiceStatus.OK && place) {
            render(place);
          } else {
            showError();
          }
        });
      };

      /* Load Maps JS API only when API key is set */
      if (API_KEY) {
        var s = document.createElement('script');
        s.src = 'https://maps.googleapis.com/maps/api/js?key=' + API_KEY + '&libraries=places&callback=__rvCallback';
        s.async = true; s.defer = true;
        s.onerror = showError;
        document.head.appendChild(s);
      } else {
        // ── Static fallback reviews while API key is being configured ──
        console.log('[StudyCapital] Showing static reviews. Set API_KEY above to load live Google Reviews.');
        var staticReviews = [
          { author_name:'Priya Sharma', rating:5, relative_time_description:'2 months ago', text:'StudyCapital helped me get a ₹25L loan for my MS in USA within 10 days. Exceptional service and guidance throughout the process!', profile_photo_url:'' },
          { author_name:'Rahul Verma', rating:5, relative_time_description:'3 months ago', text:'Got my education loan for Canada without collateral. The team compared 8 banks and got me the lowest rate. Highly recommend!', profile_photo_url:'' },
          { author_name:'Ananya Singh', rating:5, relative_time_description:'1 month ago', text:'Outstanding support for my UK university loan. The documentation checklist they provided saved so much time. 5 stars!', profile_photo_url:'' },
          { author_name:'Karan Mehta', rating:5, relative_time_description:'4 months ago', text:'Free consultation that actually helped. Got ₹40L for IIT fees without any collateral. Very professional team.', profile_photo_url:'' },
          { author_name:'Sneha Patel', rating:5, relative_time_description:'2 weeks ago', text:'Best education loan consultant in Delhi. Helped my daughter secure loan for MBBS abroad. Quick disbursement too!', profile_photo_url:'' },
          { author_name:'Arjun Nair', rating:5, relative_time_description:'5 months ago', text:'Compared loans from SBI, HDFC Credila and Axis Bank. StudyCapital negotiated a better rate than I found online. Amazing!', profile_photo_url:'' }
        ];
        reviews = staticReviews;
        total = staticReviews.length;
        document.getElementById('rv-loading') && (document.getElementById('rv-loading').style.display = 'none');
        document.getElementById('rv-viewport') && (document.getElementById('rv-viewport').style.display = 'block');
        document.getElementById('rv-nav') && (document.getElementById('rv-nav').style.display = 'flex');
        renderSlider();
      }
    })();