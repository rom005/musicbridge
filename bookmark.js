javascript:(function(){
    window.location.href = 'https://example.com';
    var link = window.location.href;
    window.location.href = 'http://localhost:3000/?link=' + encodeURIComponent(link);
})();