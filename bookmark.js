javascript:(function(){
    window.location.href = 'https://example.com';
    var link = window.location.href;
    window.location.href = 'https://musicbridge-848d.onrender.com/?link=' + encodeURIComponent(link);
})();