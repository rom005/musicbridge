javascript:(function(){
    var backend = 'https://YOUR-HOSTLESS-APP-URL'; // TODO: replace with your deployed MusicBridge URL
    var link = window.location.href;
    window.location.href = backend + '/?link=' + encodeURIComponent(link);
})();
